import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { QuestState, QuestStatus } from "@/app/lib/quests/availability";
import { requirementLabel } from "@/app/lib/quests/display";
import type { QuestSummary } from "@/app/lib/quests/types";
import { cn } from "@/lib/utils";

export const heading = "text-xs font-bold uppercase tracking-widest text-[#9a8866]";
export const panel = "border border-[#1a1a1a] bg-[#0c0c0c]";
export const chip =
  "inline-block border border-[#2a2a2a] px-2.5 py-1.5 text-xs text-[#aaa] hover:border-[#9a8866] hover:text-[#e6d9b8]";
export const textLink = "text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline";
export const empty = "border border-dashed border-[#2a2a2a] p-6 text-center text-sm text-[#888]";

export function Badge({ children, tone = "gold", title }: { children: ReactNode; tone?: "gold" | "plain" | "red"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "shrink-0 border px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider",
        tone === "gold" && "border-[#3a3326] bg-[#1a1610] text-[#c8b384]",
        tone === "plain" && "border-[#2a2a2a] text-[#999]",
        tone === "red" && "border-red-900/60 bg-red-950/30 text-red-300"
      )}
    >
      {children}
    </span>
  );
}

/** Kappa, Lightkeeper, found-in-raid, faction and prestige badges, as the quest list shows them. */
export function QuestBadges({ quest }: { quest: QuestSummary }) {
  const fir = quest.needs.some((need) => need.foundInRaid);
  return (
    <>
      {quest.kappaRequired && <Badge title="Needed for the Kappa container">Kappa</Badge>}
      {quest.lightkeeperRequired && <Badge title="Needed for Lightkeeper">LK</Badge>}
      {fir && <Badge title="Needs items found in raid">FIR</Badge>}
      {quest.faction && <Badge tone="plain">{quest.faction}</Badge>}
      {quest.prestige !== null && <Badge tone="plain">Prestige {quest.prestige}</Badge>}
    </>
  );
}

export const STATE_LABEL: Record<QuestState, string> = {
  completed: "Done",
  available: "Available",
  locked: "Locked",
  failed: "Failed",
};

export const STATE_TONE: Record<QuestState, string> = {
  completed: "border-emerald-900/60 bg-emerald-950/30 text-emerald-300",
  available: "border-[#3a3326] bg-[#1a1610] text-[#c8b384]",
  locked: "border-[#2a2a2a] text-[#777]",
  failed: "border-red-900/60 bg-red-950/30 text-red-300",
};

/** Why a quest is locked, in a few words: what to do first, the level, or the faction. */
export function lockedReason(status: QuestStatus, name: (id: string) => string) {
  const reasons: string[] = [];
  if (status.otherFaction) reasons.push("Other faction");
  if (status.level !== null) reasons.push(`Level ${status.level}`);
  for (const requirement of status.missing) reasons.push(`${requirementLabel(requirement.status)} ${name(requirement.id)}`);
  return reasons.join(" · ");
}

export function StatePill({ state, title }: { state: QuestState; title?: string }) {
  return (
    <span title={title} className={cn("shrink-0 border px-1.5 py-0.5 text-3xs font-bold uppercase tracking-wider", STATE_TONE[state])}>
      {STATE_LABEL[state]}
    </span>
  );
}

/** The tick a quest is marked complete with; a 40px target for touch. */
export function CompleteToggle({
  name,
  completed,
  disabled,
  onToggle,
  className,
}: {
  name: string;
  completed: boolean;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={completed}
      aria-label={completed ? `${name} is complete: un-mark it` : `Mark ${name} complete`}
      title={completed ? "Completed: click to un-mark" : "Mark complete"}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center border transition-colors focus-visible:outline-2 focus-visible:outline-[#9a8866] disabled:opacity-40",
        completed ? "border-emerald-800 bg-emerald-950/40 text-emerald-300" : "border-[#2a2a2a] text-[#444] hover:border-[#9a8866] hover:text-[#9a8866]",
        className
      )}
    >
      <Check className="h-4 w-4" aria-hidden />
    </button>
  );
}
