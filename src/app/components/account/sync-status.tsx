"use client";

import { useState } from "react";
import { AlertTriangle, CloudOff, RefreshCw, X } from "lucide-react";
import { activeLibrary, useAccountView } from "@/app/lib/account-sync/account-session";
import type { CachedRecord } from "@/app/lib/account-sync/library-cache";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The account library's sync state (§12.5): an "Offline: changes will sync" badge with the number of
 * queued changes, records changed on another device that need a choice, changes the server refused,
 * and notices (restored items, plans handed over). Shown only when signed in.
 */
export function SyncStatus() {
  const view = useAccountView();
  const [open, setOpen] = useState(false);
  if (!view?.ready) return null;
  const { status, issues, notices } = view;
  const offline = !status.online;
  const attention = issues.length;
  if (!offline && attention === 0 && notices.length === 0 && status.queued === 0) return null;

  return (
    <>
      <div className="pointer-events-none fixed bottom-3 right-3 z-1100 flex flex-col items-end gap-2" aria-live="polite">
        {(offline || status.queued > 0) && (
          <div className="pointer-events-auto flex items-center gap-2 border border-[#2a2a2a] bg-[#0c0c0c] px-3 py-2 text-xs text-[#bbb] shadow-lg">
            {offline ? <CloudOff className="h-3.5 w-3.5 text-[#c8b384]" aria-hidden /> : <RefreshCw className={cn("h-3.5 w-3.5", status.syncing && "animate-spin")} aria-hidden />}
            <span>
              {offline ? "Offline: changes will sync" : "Syncing"}
              {status.queued > 0 ? ` (${status.queued} queued)` : ""}
            </span>
          </div>
        )}
        {(attention > 0 || notices.length > 0) && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="pointer-events-auto flex items-center gap-2 border border-[#5a4a26] bg-[#16130b] px-3 py-2 text-xs font-bold text-[#e2c98a] shadow-lg hover:bg-[#1f1a0f] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {attention > 0 ? `${attention} change${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} attention` : `${notices.length} notice${notices.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Your library</DialogTitle>
            <DialogDescription>Changes that need a choice, and news about your items.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {issues.map((record) => (
              <IssueRow key={record.key} record={record} />
            ))}
            {notices.map((notice) => (
              <div key={notice.id} className="flex items-start gap-2 border border-[#1a1a1a] bg-[#0c0c0c] p-3 text-sm text-[#ccc]">
                <span className="flex-1">{notice.body}</span>
                <button type="button" title="Dismiss" className="text-[#888] hover:text-[#ddd]" onClick={() => void activeLibrary()?.dismissNotices([notice.id])}>
                  <X className="h-4 w-4" aria-hidden />
                  <span className="sr-only">Dismiss</span>
                </button>
              </div>
            ))}
            {issues.length === 0 && notices.length === 0 && <p className="text-sm text-[#888]">Nothing needs your attention.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function recordName(record: CachedRecord) {
  const value = record.local ?? record.server ?? record.problem?.value;
  return value && "name" in value ? value.name : record.kind === "setting" ? record.id : "Untitled";
}

const KIND_LABEL: Record<CachedRecord["kind"], string> = { build: "Build", item_group: "Item group", setting: "Setting" };

function IssueRow({ record }: { record: CachedRecord }) {
  const library = activeLibrary();
  if (!library) return null;
  const name = recordName(record);
  const { conflict, problem } = record;
  const atBuildLimit = record.kind === "build" && (library.usage?.builds ?? 0) >= (library.limits?.builds ?? Infinity);
  const atGroupLimit = record.kind === "item_group" && (library.usage?.itemGroups ?? 0) >= (library.limits?.itemGroups ?? Infinity);
  const full = atBuildLimit || atGroupLimit;
  const quest = record.kind === "setting";
  return (
    <div className="flex flex-col gap-2 border border-[#3a3326] bg-[#0c0c0c] p-3">
      <div className="text-sm">
        <span className="text-3xs uppercase tracking-widest text-[#888]">{KIND_LABEL[record.kind]}</span>
        <div className="font-bold text-[#ddd]">{name}</div>
      </div>
      {conflict?.type === "fields" && (
        <>
          <p className="text-sm text-[#bbb]">
            Changed on another device. {describeFields(conflict.fields)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => library.keepMine(record.key)}>
              Keep mine
            </Button>
            <Button size="sm" variant="outline" onClick={() => void library.keepTheirs(record.key)}>
              Keep theirs
            </Button>
            {!quest && (
              <Button size="sm" variant="outline" disabled={full} title={full ? "Your library is full: delete something to keep both." : undefined} onClick={() => void library.keepBoth(record.key)}>
                Keep both
              </Button>
            )}
          </div>
          {full && !quest && <p className="text-xs text-[#888]">Keep both needs room in your library: it saves your version as a copy.</p>}
        </>
      )}
      {conflict?.type === "delete" && (
        <>
          <p className="text-sm text-[#bbb]">This changed on another device. Delete anyway?</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" onClick={() => library.keepMine(record.key)}>
              Delete anyway
            </Button>
            <Button size="sm" variant="outline" onClick={() => void library.keepTheirs(record.key)}>
              Keep it
            </Button>
          </div>
        </>
      )}
      {problem && (
        <>
          <p className="text-sm text-[#bbb]">Couldn&apos;t sync: {problem.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => library.retryProblem(record.key)}>
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => void library.discardProblem(record.key)}>
              Discard
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function describeFields(fields: string[]) {
  const names = new Set(
    fields.map((field) => {
      if (field === "name") return "its name";
      if (field === "ammo") return "its ammo";
      if (field.startsWith("slot:")) return "its parts";
      if (field.startsWith("quest-progress:")) return "this quest's progress";
      return "it";
    })
  );
  return `Both devices changed ${[...names].join(" and ")}.`;
}
