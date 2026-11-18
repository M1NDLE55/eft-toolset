"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import type { GameMode } from "@/components/game-mode/mode";
import { completedDependents } from "@/app/lib/quests/availability";
import { questName } from "@/app/lib/quests/display";
import { questGraph, type QuestGraph } from "@/app/lib/quests/graph";
import { completeQuest, uncompleteQuest } from "@/app/lib/quests/progress-store";
import type { QuestProgress } from "@/app/lib/quests/types";
import { plural } from "@/app/lib/seo/format";
import { cn } from "@/lib/utils";

export interface QuestNotice {
  tone: "info" | "error";
  text: string;
}

const NO_QUESTS = questGraph([]);
const MAX_NAMED = 6;

/**
 * Marking quests complete and un-marking them, with what the page tells the player: the earlier
 * quests completing one also marked, and a question before un-marking a quest that others
 * marked complete needed.
 */
export function useQuestActions(gameMode: GameMode, graph: QuestGraph | null, progress: QuestProgress) {
  const [notice, setNotice] = useState<QuestNotice | null>(null);
  const [pending, setPending] = useState<{ id: string; name: string; dependents: string[] } | null>(null);
  const nameOf = (id: string, fallback = "this quest") => {
    const quest = graph?.byId.get(id);
    return quest ? questName(quest) : fallback;
  };

  const run = (work: () => void) => {
    try {
      work();
    } catch (reason) {
      setNotice({ tone: "error", text: reason instanceof Error ? reason.message : "Could not save your progress." });
    }
  };

  const uncomplete = (ids: string[]) =>
    run(() => {
      for (const id of ids) uncompleteQuest(gameMode, id);
      setNotice(ids.length > 1 ? { tone: "info", text: `Un-marked ${plural(ids.length, "quest")}.` } : null);
    });

  /** Completes the quest, or un-marks it, asking first when later completed quests needed it. */
  const toggle = (id: string, name = nameOf(id)) => {
    if (progress.completed.includes(id)) {
      const dependents = graph ? completedDependents(graph, id, progress.completed) : [];
      if (dependents.length > 0) setPending({ id, name, dependents });
      else uncomplete([id]);
      return;
    }
    run(() => {
      const added = completeQuest(gameMode, graph ?? NO_QUESTS, id);
      const earlier = added.filter((entry) => entry !== id);
      setNotice(
        earlier.length > 0
          ? {
              tone: "info",
              text: `Marked ${name} complete, and ${plural(earlier.length, "earlier quest")} it needed: ${listNames(earlier.map((entry) => nameOf(entry)))}.`,
            }
          : null
      );
    });
  };

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Un-mark {pending?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {pending &&
              `You marked ${plural(pending.dependents.length, "later quest")} complete that needed it: ${listNames(
                pending.dependents.map((entry) => nameOf(entry))
              )}. Un-mark them too, or only this quest?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: "outline" })} onClick={() => pending && uncomplete([pending.id])}>
            Only this quest
          </AlertDialogAction>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={() => pending && uncomplete([pending.id, ...pending.dependents])}
          >
            Un-mark all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return {
    toggle,
    notice,
    dismiss: () => setNotice(null),
    setError: (text: string) => setNotice({ tone: "error", text }),
    dialog,
  };
}

function listNames(names: string[]) {
  return names.length > MAX_NAMED ? `${names.slice(0, MAX_NAMED).join(", ")} and ${names.length - MAX_NAMED} more` : names.join(", ");
}

export function Notice({ notice, onDismiss }: { notice: QuestNotice | null; onDismiss: () => void }) {
  return (
    <div role={notice?.tone === "error" ? "alert" : "status"} aria-live="polite">
      {notice && (
        <p
          className={cn(
            "flex items-start justify-between gap-3 border px-3 py-2 text-sm",
            notice.tone === "error" ? "border-red-900/60 bg-red-950/30 text-red-200" : "border-[#3a3326] bg-[#1a1610] text-[#d8c9a3]"
          )}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-[#888] hover:text-[#ccc]">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </p>
      )}
    </div>
  );
}
