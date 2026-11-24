"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AlertTriangle, CloudOff, Download, LoaderCircle, Undo2 } from "lucide-react";
import { useParams, useRouter } from "@/app/lib/navigation/hooks";
import Link from "@/app/lib/navigation/link";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { downloadPlanFile } from "@/app/lib/raid-planner/plan-file";
import { activeLibrary, useAccountMode, useAccountView, useLibraryHydrated } from "@/app/lib/account-sync/account-session";
import { PlanSession, type SessionView } from "@/app/lib/account-sync/plan-session";
import type { AccountLibrary } from "@/app/lib/account-sync/account-library";
import type { PlanIssue } from "@/app/lib/account-sync/plan-cache";
import { LocalMissing } from "@/components/local-missing";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapStageSkeleton } from "@/app/components/raid-planner/map-chrome";
import { PlanEditor, type EditorSession } from "@/app/components/raid-planner/plan-editor";
import { overlayPanel } from "@/app/components/raid-planner/ui";
import { cn } from "@/lib/utils";
import { createLiveSession } from "./live-session";
import { PlanMembersButton } from "./plan-members";
import { highlightsOf, PresenceBar } from "./presence";

/**
 * /raid-planner/p/<planId>: an account plan, for its members (§7.3). It opens from the account cache
 * at once, so it works offline; owners and editors can edit offline too, and their changes replay
 * when the connection is back (§12.8).
 */
export function AccountPlanPage() {
  const { planId } = useParams<{ planId: string }>();
  const mode = useAccountMode();
  const hydrated = useLibraryHydrated();
  const account = useAccountView();
  const library = account?.ready ? activeLibrary() : null;

  if (!hydrated) return <MapStageSkeleton>Loading plan</MapStageSkeleton>;
  if (mode !== "account") {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-xl font-black uppercase tracking-widest text-[#e6d9b8]">Sign in to open this plan</h1>
          <p className="text-sm text-[#888]">This plan belongs to an account. Sign in to see it if it&apos;s shared with you.</p>
          <Button asChild>
            <a href={`/auth/sign-in?return=${encodeURIComponent(`/raid-planner/p/${planId}`)}`}>Sign in</a>
          </Button>
        </div>
      </div>
    );
  }
  if (!library) return <MapStageSkeleton>Loading plan</MapStageSkeleton>;
  return <PlanSessionView key={planId} library={library} planId={planId} />;
}

function useSession(library: AccountLibrary, planId: string) {
  const session = useMemo(() => createLiveSession(library, planId), [library, planId]);
  useEffect(() => {
    const release = library.planOpened(planId);
    void session.open();
    return () => {
      release();
      session.close();
    };
  }, [library, planId, session]);
  const view = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.view(),
    () => session.view()
  );
  return { session, view };
}

function PlanSessionView({ library, planId }: { library: AccountLibrary; planId: string }) {
  const router = useRouter();
  const { session, view } = useSession(library, planId);
  const highlights = useMemo(() => highlightsOf(view.presence, view.myKey), [view.presence, view.myKey]);

  if (view.offlineCopy) return <OfflineCopyView session={session} view={view} />;
  if (!view.ready) return <MapStageSkeleton>Loading plan</MapStageSkeleton>;
  if (!view.plan) {
    return <LocalMissing title={view.error ?? "Plan not found"} backHref="/raid-planner" backLabel="Back to plans" />;
  }
  const config = getMapConfig(view.plan.mapKey);
  if (!config) return <LocalMissing title="Plan map is no longer available" backHref="/raid-planner" backLabel="Back to plans" />;

  const editor: EditorSession = {
    plan: view.plan,
    readOnly: view.readOnly,
    apply: (next, options) => session.edit(next, options),
    undo: () => session.undo(),
    redo: () => session.redo(),
    canUndo: view.canUndo,
    canRedo: view.canRedo,
    share: <PlanMembersButton session={session} view={view} onLeft={() => router.push("/raid-planner")} />,
    banner: <PlanBanner session={session} view={view} />,
    onSelect: (target) => session.select(target),
    onDrag: (target, position) => {
      const id = target.slice(target.indexOf(":") + 1);
      session.preview([target.startsWith("wp:") ? { t: "wp.move", id, at: position } : { t: "note.move", id, at: position }]);
    },
    highlights,
  };
  return (
    <>
      <PlanEditor key={planId} storedPlan={view.plan} config={config} session={editor} />
      {view.conflict && <NoteConflictDialog session={session} view={view} />}
    </>
  );
}

function PlanBanner({ session, view }: { session: PlanSession; view: SessionView }) {
  const items: ReactNode[] = [];
  if (!view.online || view.pendingCreate) {
    items.push(
      <div key="offline" className={cn(overlayPanel, "flex items-center gap-2 px-3 py-2 text-xs text-[#ccc]")}>
        <CloudOff className="h-3.5 w-3.5 text-[#c8b384]" aria-hidden />
        <span>
          Offline{view.syncedAt ? ` · last synced ${new Date(view.syncedAt).toLocaleTimeString()}` : ""}
          {view.queued > 0 ? ` · ${view.queued} change${view.queued === 1 ? "" : "s"} waiting` : ""}
        </span>
      </div>
    );
  }
  if (view.error) {
    items.push(
      <p key="error" role="alert" className={cn(overlayPanel, "px-3 py-2 text-xs text-red-200")}>
        {view.error}
      </p>
    );
  }
  if (view.issues.length > 0) items.push(<IssuesPanel key="issues" session={session} issues={view.issues} />);
  for (const notice of view.notices) {
    items.push(
      <p key={notice.id} role="status" className={cn(overlayPanel, "px-3 py-2 text-xs text-[#e2c98a]")}>
        {notice.text}
      </p>
    );
  }
  const presence = <PresenceBar session={session} view={view} />;
  if (items.length === 0) return presence;
  return (
    <div className="flex flex-col gap-2">
      {presence}
      {items}
    </div>
  );
}

/** "Couldn't apply" (§12.8): offline changes the plan refused, kept until the user chooses. */
function IssuesPanel({ session, issues }: { session: PlanSession; issues: PlanIssue[] }) {
  return (
    <div className={cn(overlayPanel, "flex flex-col gap-2 border-[#5a4a26] p-3 text-xs")}>
      <p className="flex items-center gap-2 font-bold uppercase tracking-widest text-[#e2c98a]">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Couldn&apos;t apply
      </p>
      {issues.map((issue) => (
        <div key={issue.opId} className="flex flex-wrap items-center gap-2 border-t border-[#2a2a2a] pt-2 text-[#ccc]">
          <span className="min-w-0 flex-1">{issue.message}</span>
          {issue.kind === "gone" && issue.restore.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => void session.addBack(issue.opId)}>
              <Undo2 /> Add it back
            </Button>
          )}
          {issue.kind === "limit" && (
            <Button size="sm" variant="outline" onClick={() => void session.retryIssue(issue.opId)}>
              Try again
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void session.dropIssue(issue.opId)}>
            Discard
          </Button>
        </div>
      ))}
    </div>
  );
}

function NoteConflictDialog({ session, view }: { session: PlanSession; view: SessionView }) {
  const conflict = view.conflict!;
  const [busy, setBusy] = useState(false);
  const choose = async (choice: "mine" | "theirs" | "both") => {
    setBusy(true);
    await session.resolveConflict(choice);
    setBusy(false);
  };
  return (
    <Dialog open>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{conflict.byName} changed this note while you were editing</DialogTitle>
          <DialogDescription>
            {conflict.title ? `“${conflict.title}”: ` : ""}choose which {conflict.field === "title" ? "title" : "text"} to keep.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border border-[#2a2a2a] p-2 text-sm">
            <p className="text-3xs font-bold uppercase tracking-widest text-[#888]">Yours</p>
            <p className="mt-1 whitespace-pre-wrap text-[#ddd]">{conflict.mine || "(empty)"}</p>
          </div>
          <div className="border border-[#2a2a2a] p-2 text-sm">
            <p className="text-3xs font-bold uppercase tracking-widest text-[#888]">{conflict.byName}&apos;s</p>
            <p className="mt-1 whitespace-pre-wrap text-[#ddd]">{conflict.theirs || "(empty)"}</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void choose("theirs")}>
            Keep theirs
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void choose("both")}>
            Keep both
          </Button>
          <Button disabled={busy} onClick={() => void choose("mine")}>
            Keep mine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Access ended while this device had offline changes (§12.8): the copy of what the user last saw is
 * kept here, never synced, until they save it as their own plan, download it, or discard it.
 */
function OfflineCopyView({ session, view }: { session: PlanSession; view: SessionView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = view.offlineCopy!;
  const content = session.offlineCopyContent();
  const counts = { route: Object.keys(copy.doc.waypoints).length, drawings: Object.keys(copy.doc.drawings).length, notes: Object.keys(copy.doc.notes).length };
  return (
    <main className="flex flex-1 justify-center p-4">
      <div className="flex w-full max-w-lg flex-col gap-4 py-10">
        <h1 className="text-xl font-black uppercase tracking-widest text-[#e6d9b8]">Offline copy</h1>
        <p className="text-sm text-[#bbb]">
          {copy.reason} Your offline changes are kept here: “{copy.name}”, {counts.route} route points, {counts.drawings} drawings, {counts.notes} notes.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const result = await session.saveOfflineCopy();
              setBusy(false);
              if (result.ok) router.push(`/raid-planner/p/${result.planId}`);
              else setError(result.message);
            }}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : null} Save as my own plan
          </Button>
          <Button variant="outline" disabled={!content} onClick={() => content && downloadPlanFile([{ id: session.planId, createdAt: copy.createdAt, updatedAt: copy.createdAt, ...content }])}>
            <Download /> Download as file
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await session.discardOfflineCopy();
              router.push("/raid-planner");
            }}
          >
            Discard
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <Link href="/raid-planner" className="text-xs text-[#888] hover:text-[#ccc]">
          Back to plans
        </Link>
      </div>
    </main>
  );
}
