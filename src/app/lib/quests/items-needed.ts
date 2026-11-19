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
  /**
   * With no faction set, quests with a USEC and a BEAR version were counted once each, the larger
   * need per item; setting a faction counts only that faction's.
   */
  factionVersions: boolean;
  /** How many quests were counted, a quest's USEC and BEAR versions as one. */
  quests: number;
}

/** By default every quest not completed or failed, and not only for the other faction. */
export const stillToDo = (_quest: QuestSummary, status: QuestStatus | undefined) =>
  !status || (status.state !== "completed" && status.state !== "failed" && !status.otherFaction);

/** Quests that are the USEC and BEAR versions of one another share a trader, name and prestige. */
const versionKey = (quest: QuestSummary) => `${quest.trader}\u0000${quest.name}\u0000${quest.prestige ?? ""}`;

/**
 * The items the player still needs: every need of the quests `include` keeps, except needs
 * with an objective marked done (handed over, or found for a later hand-over). With no faction
 * set, a quest's USEC and BEAR versions count once: the larger need per item, shown against the
 * version that needs it.
 */
export function itemsNeeded(
  graph: QuestGraph,
  progress: QuestProgress,
  include: (quest: QuestSummary, status: QuestStatus | undefined) => boolean = stillToDo,
  states: ReadonlyMap<string, QuestStatus> = questStates(graph, progress)
): ItemsNeeded {
  const done = new Set(progress.objectives);
  const groups = new Map<string, QuestSummary[]>();
  for (const quest of graph.quests) {
    if (!include(quest, states.get(quest.id))) continue;
    const key = progress.faction === null && quest.faction ? versionKey(quest) : quest.id;
    groups.set(key, [...(groups.get(key) ?? []), quest]);
  }

  const items = new Map<string, NeededItem>();
  const choices: NeededChoice[] = [];
  let factionVersions = false;
  for (const group of groups.values()) {
    if (group.length > 1) factionVersions = true;
    // Per item and found-in-raid or not: the most any one version needs, and that version.
    const largest = new Map<string, { item: string; foundInRaid: boolean; count: number; quest: string }>();
    const groupChoices = new Map<string, NeededChoice>();
    for (const quest of group) {
      const own = new Map<string, { item: string; foundInRaid: boolean; count: number; quest: string }>();
      for (const need of quest.needs) {
        if (need.objectives.some((id) => done.has(id))) continue;
        if (need.items.length !== 1 || need.alternatives !== undefined) {
          const key = JSON.stringify([need.label, need.items, need.count, need.foundInRaid]);
          if (!groupChoices.has(key)) groupChoices.set(key, { quest: quest.id, need });
          continue;
        }
        const key = `${need.items[0]}\u0000${need.foundInRaid}`;
        const tally = own.get(key) ?? { item: need.items[0], foundInRaid: need.foundInRaid, count: 0, quest: quest.id };
        tally.count += need.count;
        own.set(key, tally);
      }
      for (const [key, tally] of own) {
        if ((largest.get(key)?.count ?? 0) < tally.count) largest.set(key, tally);
      }
    }
    choices.push(...groupChoices.values());
    for (const tally of largest.values()) {
      const entry = items.get(tally.item) ?? { id: tally.item, foundInRaid: 0, other: 0, quests: [] };
      if (tally.foundInRaid) entry.foundInRaid += tally.count;
      else entry.other += tally.count;
      entry.quests.push({ id: tally.quest, count: tally.count, foundInRaid: tally.foundInRaid });
      items.set(tally.item, entry);
    }
  }
  return {
    items: Array.from(items.values()).sort(
      (a, b) => b.foundInRaid + b.other - (a.foundInRaid + a.other) || a.id.localeCompare(b.id)
    ),
    choices,
    factionVersions,
    quests: groups.size,
  };
}
