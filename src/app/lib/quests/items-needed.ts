import { questStates, type QuestStatus } from "./availability";
import type { QuestGraph } from "./graph";
import type { QuestItemNeed, QuestProgress, QuestSummary } from "./types";

export interface NeededItem {
  id: string;
  /** How many must be found in raid. */
  foundInRaid: number;
  /** How many more will do from anywhere: bought, crafted or found. */
  other: number;
  quests: { id: string; count: number; foundInRaid: boolean }[];
}

/** A need any of several items will meet, kept apart so nothing is counted twice. */
export interface NeededChoice {
  quest: string;
  need: QuestItemNeed;
}

export interface ItemsNeeded {
  /** Grouped by item, the most needed first. */
  items: NeededItem[];
  choices: NeededChoice[];
}

/** By default every quest not completed or failed, and not only for the other faction. */
export const stillToDo = (_quest: QuestSummary, status: QuestStatus | undefined) =>
  !status || (status.state !== "completed" && status.state !== "failed" && !status.otherFaction);

/**
 * The items the player still needs: every need of the quests `include` keeps, except needs
 * with an objective marked done (handed over, or found for a later hand-over).
 */
export function itemsNeeded(
  graph: QuestGraph,
  progress: QuestProgress,
  include: (quest: QuestSummary, status: QuestStatus | undefined) => boolean = stillToDo,
  states: ReadonlyMap<string, QuestStatus> = questStates(graph, progress)
): ItemsNeeded {
  const done = new Set(progress.objectives);
  const items = new Map<string, NeededItem>();
  const choices: NeededChoice[] = [];
  for (const quest of graph.quests) {
    if (!include(quest, states.get(quest.id))) continue;
    for (const need of quest.needs) {
      if (need.objectives.some((id) => done.has(id))) continue;
      if (need.items.length !== 1 || need.alternatives !== undefined) {
        choices.push({ quest: quest.id, need });
        continue;
      }
      const id = need.items[0];
      const entry = items.get(id) ?? { id, foundInRaid: 0, other: 0, quests: [] };
      if (need.foundInRaid) entry.foundInRaid += need.count;
      else entry.other += need.count;
      const forQuest = entry.quests.find((other) => other.id === quest.id && other.foundInRaid === need.foundInRaid);
      if (forQuest) forQuest.count += need.count;
      else entry.quests.push({ id: quest.id, count: need.count, foundInRaid: need.foundInRaid });
      items.set(id, entry);
    }
  }
  return {
    items: Array.from(items.values()).sort(
      (a, b) => b.foundInRaid + b.other - (a.foundInRaid + a.other) || a.id.localeCompare(b.id)
    ),
    choices,
  };
}
