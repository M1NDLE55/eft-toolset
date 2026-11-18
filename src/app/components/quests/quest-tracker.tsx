"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check } from "lucide-react";
import type { GameMode } from "@/components/game-mode/mode";
import { MODE_LABEL } from "@/components/game-mode/use-server-mode-sync";
import { questStates, type QuestStatus } from "@/app/lib/quests/availability";
import { questGraph } from "@/app/lib/quests/graph";
import { setObjectiveDone, useQuestProgress } from "@/app/lib/quests/progress-store";
import { useQuestList } from "@/app/lib/quests/query";
import type { QuestMap, QuestObjective, QuestObjectiveCondition, QuestProgress, QuestRef, QuestItem } from "@/app/lib/quests/types";
import { useHydrated } from "@/app/lib/storage/use-store";
import { cn } from "@/lib/utils";
import { ItemLink } from "./items-needed-view";
import { Badge, CompleteToggle, StatePill, lockedReason, panel } from "./quest-bits";
import { Notice, useQuestActions } from "./use-quest-actions";

interface Tracking {
  gameMode: GameMode;
  hydrated: boolean;
  progress: QuestProgress;
  /** Every quest's status, once the list for this mode and the progress have loaded. */
  statuses: ReadonlyMap<string, QuestStatus> | null;
  actions: ReturnType<typeof useQuestActions>;
}

const TrackingContext = createContext<Tracking | null>(null);

function useTracking() {
  const tracking = useContext(TrackingContext);
  if (!tracking) throw new Error("Quest tracking needs a QuestTrackingProvider");
  return tracking;
}

/**
 * The player's progress in the quest's game mode, for the page's islands. The quest list loads
 * in the background (from the browser's cache when it has it) to work out what's available and
 * which earlier quests completing this one implies.
 */
export function QuestTrackingProvider({ gameMode, children }: { gameMode: GameMode; children: ReactNode }) {
  const hydrated = useHydrated();
  const query = useQuestList();
  const progress = useQuestProgress(gameMode);
  const list = query.list && query.gameMode === gameMode ? query.list : null;
  const graph = list ? questGraph(list.quests) : null;
  const statuses = useMemo(() => (graph && hydrated ? questStates(graph, progress) : null), [graph, hydrated, progress]);
  const actions = useQuestActions(gameMode, graph, progress);
  return (
    <TrackingContext.Provider value={{ gameMode, hydrated, progress, statuses, actions }}>
      {children}
      {actions.dialog}
    </TrackingContext.Provider>
  );
}

/** The player's status for a linked quest, once known. */
export function QuestStateTag({ id }: { id: string }) {
  const { statuses } = useTracking();
  const status = statuses?.get(id);
  return status ? <StatePill state={status.state} /> : null;
}

/** Marks the quest complete, and says where it stands for the player. */
export function QuestCompletePanel({ quest, names }: { quest: QuestRef; names: Record<string, QuestRef> }) {
  const { gameMode, hydrated, progress, statuses, actions } = useTracking();
  const completed = progress.completed.includes(quest.id);
  const status = statuses?.get(quest.id);
  const nameOf = (id: string) => names[id]?.name ?? "another quest";
  const summary = !hydrated
    ? "Loading your progress…"
    : completed
      ? "You marked this quest complete."
      : status?.state === "available"
        ? "Available to you now."
        : status?.state === "failed"
          ? "Failed: you completed the other branch."
          : status?.state === "locked"
            ? `Locked: ${lockedReason(status, nameOf)}.`
            : "Not complete yet.";
  return (
    <div className="flex flex-col gap-2">
      <div className={cn(panel, "flex items-center gap-3 p-3")}>
        <CompleteToggle name={quest.name} completed={completed} disabled={!hydrated} onToggle={() => actions.toggle(quest.id, quest.name)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold text-[#ddd]">{completed ? "Completed" : "Mark complete"}</span>
          <span className="text-xs text-[#888]">
            {summary} {hydrated && <span className="text-[#666]">{MODE_LABEL[gameMode]} progress, saved in this browser.</span>}
          </span>
        </div>
        {status && <StatePill state={status.state} />}
      </div>
      <Notice notice={actions.notice} onDismiss={actions.dismiss} />
    </div>
  );
}

const CONDITION_LABEL: Record<QuestObjectiveCondition["kind"], string> = {
  usingWeapon: "With any of",
  usingWeaponMods: "With mods",
  wearing: "Wearing",
  notWearing: "Not wearing",
};

function Conditions({ conditions, items }: { conditions: QuestObjectiveCondition[]; items: Record<string, QuestItem> }) {
  const link = "text-[#aaa] underline-offset-2 hover:text-[#e6d9b8] hover:underline";
  return conditions.map((condition) => (
    <p key={condition.kind} className="text-xs text-[#888]">
      <span className="text-[#9a8866]">{CONDITION_LABEL[condition.kind]}:</span>{" "}
      {condition.groups.map((group, index) => (
        <span key={index}>
          {index > 0 && (condition.kind === "usingWeaponMods" || condition.kind === "wearing" ? ", or " : ", ")}
          {group.map((id, position) => (
            <span key={id}>
              {position > 0 && " + "}
              <ItemLink item={items[id]} className={link} />
            </span>
          ))}
        </span>
      ))}
    </p>
  ));
}

/** The quest's objectives as a checklist: ticks are saved with the player's progress. */
export function ObjectiveChecklist({
  objectives,
  items,
  maps,
}: {
  objectives: QuestObjective[];
  items: Record<string, QuestItem>;
  maps: Record<string, QuestMap>;
}) {
  const { gameMode, hydrated, progress, actions } = useTracking();
  const done = new Set(progress.objectives);
  const link = "text-[#aaa] underline-offset-2 hover:text-[#e6d9b8] hover:underline";
  return (
    <ul className={`${panel} divide-y divide-[#151515]`}>
      {objectives.map((objective) => {
        const checked = done.has(objective.id);
        // Variants (Ground Zero 21+) are named after the map whose page they share.
        const objectiveMaps = Array.from(
          new Set(objective.maps.map((key) => (maps[key]?.page && maps[maps[key].page!]?.name) || maps[key]?.name || key))
        );
        // "Hand over the item: Salewa" already names its one item.
        const named = objective.items.length === 1 && Boolean(items[objective.items[0]]?.name && objective.description.includes(items[objective.items[0]].name));
        return (
          <li key={objective.id} className="flex items-start gap-3 px-3 py-2.5">
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={objective.description || "Objective"}
              disabled={!hydrated}
              onClick={() => {
                try {
                  setObjectiveDone(gameMode, objective.id, !checked);
                } catch (reason) {
                  actions.setError(reason instanceof Error ? reason.message : "Could not save your progress.");
                }
              }}
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border transition-colors focus-visible:outline-2 focus-visible:outline-[#9a8866] disabled:opacity-40",
                checked ? "border-emerald-800 bg-emerald-950/40 text-emerald-300" : "border-[#2a2a2a] text-transparent hover:border-[#9a8866]"
              )}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className={cn("text-sm", checked ? "text-[#777] line-through" : "text-[#ddd]")}>
                {objective.description || "Objective"}
                {objective.count !== null && objective.count > 1 && <span className="ml-2 text-xs text-[#9a8866]">×{objective.count}</span>}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {objective.optional && <Badge tone="plain">Optional</Badge>}
                {objective.foundInRaid && <Badge>Found in raid</Badge>}
                {objectiveMaps.length > 0 && <span className="text-[11px] text-[#777]">{objectiveMaps.join(", ")}</span>}
              </div>
              {objective.questItem && (
                <p className="flex items-center gap-2 text-xs text-[#999]">
                  {objective.questItem.image && (
                    <Image src={objective.questItem.image} alt="" width={24} height={24} className="h-6 w-6 object-contain" />
                  )}
                  Quest item: {objective.questItem.name}
                  <span className="text-[#666]">(only spawns while the quest is active)</span>
                </p>
              )}
              {objective.items.length > 0 && !named && (
                <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[#888]">
                  {objective.items.length > 1 && "Any of:"}
                  {objective.items.slice(0, 12).map((id) => (
                    <ItemLink key={id} item={items[id]} className={link} />
                  ))}
                  {objective.alternatives > 12 && <span>and {objective.alternatives - 12} more</span>}
                </p>
              )}
              {objective.items.length === 0 && objective.alternatives > 0 && (
                <p className="text-xs text-[#888]">Any of {objective.alternatives} qualifying items.</p>
              )}
              <Conditions conditions={objective.conditions} items={items} />
              {objective.requiredKeys.length > 0 && (
                <p className="text-xs text-[#888]">
                  <span className="text-[#9a8866]">Keys:</span>{" "}
                  {objective.requiredKeys.map((group, index) => (
                    <span key={index}>
                      {index > 0 && " and "}
                      {group.map((id, position) => (
                        <span key={id}>
                          {position > 0 && " or "}
                          <ItemLink item={items[id]} className={link} />
                        </span>
                      ))}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Links to a quest with the player's status beside it. */
export function QuestRefLink({ quest, note }: { quest: QuestRef; note?: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {quest.slug ? (
        <Link href={`/quests/${quest.slug}`} className="text-sm text-[#ccc] underline-offset-2 hover:text-[#e6d9b8] hover:underline">
          {quest.name}
        </Link>
      ) : (
        <span className="text-sm text-[#ccc]">{quest.name}</span>
      )}
      {quest.faction && <Badge tone="plain">{quest.faction}</Badge>}
      {note && <span className="text-[11px] text-[#777]">{note}</span>}
      <QuestStateTag id={quest.id} />
    </span>
  );
}
