"use client";

import { useEffect, useState } from "react";
import { Copy, Crown, Download, LogOut, Trash2, Users } from "lucide-react";
import { useRouter } from "@/app/lib/navigation/hooks";
import { downloadPlanFile } from "@/app/lib/raid-planner/plan-file";
import type { PlanSession, SessionView } from "@/app/lib/account-sync/plan-session";
import type { PublicMember } from "@/app/lib/durable/plan-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LinksPanel } from "@/app/components/sharing/links-panel";
import { iconButton } from "@/app/components/raid-planner/ui";
import { ReportButton } from "@/app/sharing/report-button";

const ROLE_LABEL = { owner: "Owner", editor: "Editor", viewer: "Viewer" } as const;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", headers: init.body ? { "Content-Type": "application/json" } : undefined });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Something went wrong. Try again.");
  return body;
}

/**
 * Host (§4, §8.1): members and their roles, invites and links, "Allow copies", copy and export,
 * transfer, leave and delete. Owner administration acts on other people, so it needs a connection.
 */
export function PlanMembersButton({ session, view, onLeft }: { session: PlanSession; view: SessionView; onLeft: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<PublicMember[]>(view.members);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const owner = view.role === "owner";
  const planId = session.planId;
  const plan = view.plan!;
  const canCopy = owner || view.allowCopy;

  useEffect(() => {
    if (!open || !view.online) return;
    let active = true;
    call<{ members: PublicMember[] }>(`/api/plans/${planId}/members`)
      .then((body) => active && setMembers(body.members))
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "Members couldn't be loaded."));
    return () => {
      active = false;
    };
  }, [open, planId, view.online, view.members]);

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      const body = await call<{ members: PublicMember[] }>(`/api/plans/${planId}/members`).catch(() => null);
      if (body) setMembers(body.members);
      await session.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={iconButton} title="Members and sharing">
          <Users className="h-4 w-4" aria-hidden />
          <span className="sr-only">Members and sharing</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan.name}</DialogTitle>
          <DialogDescription>
            You&apos;re {view.role === "owner" ? "the owner" : `${view.role === "editor" ? "an editor" : "a viewer"}`}.{" "}
            {view.online ? "" : "Sharing and members need a connection."}
          </DialogDescription>
        </DialogHeader>

        <section className="flex flex-col gap-2">
          <h3 className="text-3xs font-bold uppercase tracking-widest text-[#c8b384]">Members · {members.length}</h3>
          <ul className="flex flex-col gap-1">
            {members.map((member) => (
              <li key={member.key} className="flex flex-wrap items-center gap-2 border border-[#1a1a1a] px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-[#ddd]">
                  {member.displayName}
                  {member.you ? " (you)" : ""}
                </span>
                {owner && !member.you && member.role !== "owner" ? (
                  <>
                    <select
                      aria-label={`Role for ${member.displayName}`}
                      value={member.role}
                      disabled={busy || !view.online}
                      onChange={(event) => void act(() => call(`/api/plans/${planId}/members/${member.key}`, { method: "PATCH", body: JSON.stringify({ role: event.target.value }) }))}
                      className="h-8 border border-[#2a2a2a] bg-[#0c0c0c] px-1 text-xs text-[#ddd]"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="outline" disabled={busy || !view.online} title="Make owner">
                          <Crown />
                        </Button>
                      }
                      title={`Hand ${plan.name} to ${member.displayName}?`}
                      description="They become the owner, and you stay on as an editor."
                      confirmLabel="Hand over"
                      onConfirm={() => void act(() => call(`/api/plans/${planId}/transfer`, { method: "POST", body: JSON.stringify({ to: member.key }) }))}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !view.online}
                      title="Remove"
                      onClick={() => void act(() => call(`/api/plans/${planId}/members/${member.key}`, { method: "DELETE" }))}
                    >
                      <Trash2 />
                    </Button>
                  </>
                ) : (
                  <span className="text-3xs uppercase tracking-widest text-[#888]">{ROLE_LABEL[member.role]}</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {(owner || view.role === "editor") && (
          <section className="flex flex-col gap-2">
            <h3 className="text-3xs font-bold uppercase tracking-widest text-[#c8b384]">{owner ? "Invites and links" : "Invite viewers"}</h3>
            <LinksPanel
              target={{ type: "plan", id: planId }}
              role={owner ? "owner" : "editor"}
              allowCopy={view.allowCopy}
              online={view.online}
              onAllowCopyChange={owner ? (allow) => act(() => call(`/api/plans/${planId}/settings`, { method: "PATCH", body: JSON.stringify({ allowCopy: allow }) })) : undefined}
            />
          </section>
        )}

        <section className="flex flex-wrap gap-2 border-t border-[#1a1a1a] pt-3">
          {canCopy && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !view.online}
                onClick={() =>
                  void act(async () => {
                    const copy = await call<{ url: string }>(`/api/plans/${planId}/copy`, { method: "POST", body: "{}" });
                    setOpen(false);
                    router.push(copy.url);
                  })
                }
              >
                <Copy /> Save a copy
              </Button>
              <Button size="sm" variant="outline" onClick={() => downloadPlanFile([plan])}>
                <Download /> Download
              </Button>
            </>
          )}
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="outline" disabled={busy || !view.online}>
                <LogOut /> Leave
              </Button>
            }
            title={`Leave ${plan.name}?`}
            description={owner ? "The plan passes to the next member (editors first). If no one else is in it, it is deleted." : "You can join again only with a new invite."}
            confirmLabel="Leave"
            onConfirm={() =>
              void act(async () => {
                await call(`/api/plans/${planId}/leave`, { method: "POST", body: "{}" });
                onLeft();
              })
            }
          />
          {!owner && <ReportButton subject={{ plan: planId }} compact={false} />}
          {owner && (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" className="text-red-300" disabled={busy || !view.online}>
                  <Trash2 /> Delete plan
                </Button>
              }
              title={`Delete ${plan.name}?`}
              description="It is deleted for everyone, and its links stop working. This cannot be undone."
              confirmLabel="Delete for everyone"
              onConfirm={() =>
                void act(async () => {
                  await call(`/api/plans/${planId}`, { method: "DELETE" });
                  onLeft();
                })
              }
            />
          )}
        </section>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
