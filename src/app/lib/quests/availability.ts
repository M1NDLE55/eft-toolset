import type { QuestGraph } from "./graph";
import type { Faction, QuestProgress, QuestRequirement, QuestSummary } from "./types";

/** Only for the other faction: a player of `faction` never gets it. Without a faction set, nothing is. */
const forOtherFaction = (quest: QuestSummary, faction: Faction | null) => Boolean(faction && quest.faction && quest.faction !== faction);

export type QuestState = "completed" | "failed" | "available" | "locked";

export interface QuestStatus {
  state: QuestState;
  /** Requirements on other quests that aren't met yet. */
  missing: QuestRequirement[];
  /** The level the quest needs, when the player's is lower. */
  level: number | null;
  /** The quest is only for the other faction. */
  otherFaction: boolean;
}

/**
 * Where each quest stands for the player:
 *
 * - completed: marked complete, even if the data says it was failed (the player knows best).
 * - failed: the other branch of a choice was completed (one of `failedBy` is complete).
 * - available: every requirement is met, the level is high enough and the faction matches.
 *   A requirement to complete a quest needs it completed; to start one, needs it completed,
 *   any of its objectives done, or the quest available now, since both can be taken together;
 *   to fail one, needs it failed. Requirements on quests the list doesn't have, or only for
 *   the other faction once the faction is set, are ignored.
 *   Without a level or faction set, those aren't checked. Trader loyalty isn't tracked.
 * - locked: anything else, with what's missing.
 */
export function questStates(graph: QuestGraph, progress: QuestProgress): Map<string, QuestStatus> {
  const completed = new Set(progress.completed);
  const done = new Set(progress.objectives);
  const states = new Map<string, QuestStatus>();
  const visiting = new Set<string>();

  const isFailed = (quest: QuestSummary) =>
    !completed.has(quest.id) &&
    quest.failedBy.some((entry) => entry.status.includes("complete") && completed.has(entry.id));
  const isStarted = (quest: QuestSummary) =>
    completed.has(quest.id) ||
    [...quest.objectives, ...quest.optionalObjectives].some((id) => done.has(id)) ||
    statusOf(quest).state === "available";
  const met = (requirement: QuestRequirement) => {
    const other = graph.byId.get(requirement.id);
    // Some quests for both factions require one only USEC gets: the other faction can't do it, so it doesn't hold them back.
    if (!other || forOtherFaction(other, progress.faction)) return true;
    return (
      (requirement.status.includes("complete") && completed.has(other.id)) ||
      (requirement.status.includes("failed") && isFailed(other)) ||
      (requirement.status.includes("active") && isStarted(other))
    );
  };

  function statusOf(quest: QuestSummary): QuestStatus {
    const known = states.get(quest.id);
    if (known) return known;
    // A requirement cycle in the data: count the quest as locked while it is being worked out.
    if (visiting.has(quest.id)) return { state: "locked", missing: [], level: null, otherFaction: false };
    visiting.add(quest.id);
    const otherFaction = forOtherFaction(quest, progress.faction);
    const level = progress.level !== null && quest.minPlayerLevel > progress.level ? quest.minPlayerLevel : null;
    let status: QuestStatus;
    if (completed.has(quest.id)) {
      status = { state: "completed", missing: [], level: null, otherFaction };
    } else if (isFailed(quest)) {
      status = { state: "failed", missing: [], level: null, otherFaction };
    } else {
      const missing = quest.requires.filter((requirement) => !met(requirement));
      const state = missing.length === 0 && level === null && !otherFaction ? "available" : "locked";
      status = { state, missing, level, otherFaction };
    }
    visiting.delete(quest.id);
    states.set(quest.id, status);
    return status;
  }

  for (const quest of graph.quests) statusOf(quest);
  return states;
}

const strictlyComplete = (requirement: QuestRequirement) =>
  requirement.status.length > 0 && requirement.status.every((status) => status === "complete");

/**
 * The quest and every quest it needed completed first, recursively: what completing it implies.
 * Requirements that starting or failing a quest also satisfies are left alone, since either
 * could be true, and so are quests only for the other faction, which the player never got.
 */
export function withPrerequisites(graph: QuestGraph, id: string, faction: Faction | null = null): string[] {
  const result: string[] = [];
  const pending = [id];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current) || !graph.byId.has(current)) continue;
    seen.add(current);
    if (current !== id && forOtherFaction(graph.byId.get(current)!, faction)) continue;
    result.push(current);
    for (const requirement of graph.byId.get(current)!.requires) {
      if (strictlyComplete(requirement)) pending.push(requirement.id);
    }
  }
  return result;
}

/** Completed quests that needed this one completed, recursively: what un-completing it contradicts. */
export function completedDependents(graph: QuestGraph, id: string, completed: Iterable<string>): string[] {
  const done = new Set(completed);
  const result: string[] = [];
  const pending = [id];
  const seen = new Set<string>([id]);
  while (pending.length > 0) {
    for (const next of graph.unlocks.get(pending.pop()!) ?? []) {
      if (seen.has(next.id) || !strictlyComplete(next) || !done.has(next.id)) continue;
      seen.add(next.id);
      result.push(next.id);
      pending.push(next.id);
    }
  }
  return result;
}
