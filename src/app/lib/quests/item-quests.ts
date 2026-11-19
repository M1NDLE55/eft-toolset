import { baseMapName, questTitleName, sameNameHints } from "./display";
import { questGraph } from "./graph";
import { TRADER_ORDER } from "./order";
import type { QuestList, QuestSummary } from "./types";

/** An objective that takes any one of several items, this one among them. */
export interface ItemQuestAnyOf {
  count: number;
  foundInRaid: boolean;
  /** What the objective asks for, such as "Hand over any found in raid medicine items". */
  label: string | null;
  /** How many items qualify, this one included. */
  accepted: number;
}

export interface ItemQuestNeed {
  quest: QuestSummary;
  /** The quest's name, with its faction and, for quests that share a name, a hint telling them apart. */
  name: string;
  hint: string | null;
  /** How many of this very item the quest's objectives take, summed over them; 0 when it only takes it among alternatives. */
  count: number;
  /** How many of those must be found in raid. */
  foundInRaid: number;
  anyOf: ItemQuestAnyOf[];
}

export interface ItemQuestKey {
  quest: QuestSummary;
  name: string;
  hint: string | null;
  /** Names of the maps the key is listed for, variants merged into their base map. */
  maps: string[];
}

export interface ItemQuests {
  needed: ItemQuestNeed[];
  keys: ItemQuestKey[];
}

const TRADER_RANK: ReadonlyMap<string, number> = new Map(TRADER_ORDER.map((name, index) => [name, index]));

/** Lowest level first (0 and 1 both mean open from the start), then the game's trader order, then name. */
function byProgression(a: { quest: QuestSummary; name: string }, b: { quest: QuestSummary; name: string }) {
  const rank = (quest: QuestSummary) => (quest.trader === null ? Infinity : (TRADER_RANK.get(quest.trader) ?? TRADER_ORDER.length));
  return (
    Math.max(a.quest.minPlayerLevel, 1) - Math.max(b.quest.minPlayerLevel, 1) ||
    rank(a.quest) - rank(b.quest) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * The quests that take an item (hand it over, find it, plant it) and the quests that need it as a key, from the
 * quest list. Quests without a page are left out. Quests that need this very item come before those that take it
 * among alternatives; each group in the order they're played.
 */
export function questsUsingItem(list: QuestList, itemId: string): ItemQuests {
  const hints = sameNameHints(questGraph(list.quests), list.maps);
  const named = (quest: QuestSummary) => ({ quest, name: questTitleName(quest), hint: hints.get(quest.id) ?? null });
  const needed: ItemQuestNeed[] = [];
  const keys: ItemQuestKey[] = [];
  for (const quest of list.quests) {
    if (!quest.slug) continue;
    let count = 0;
    let foundInRaid = 0;
    const anyOf: ItemQuestAnyOf[] = [];
    for (const need of quest.needs) {
      if (!need.items.includes(itemId)) continue;
      if (need.items.length === 1 && need.alternatives === undefined) {
        count += need.count;
        if (need.foundInRaid) foundInRaid += need.count;
      } else {
        anyOf.push({
          count: need.count,
          foundInRaid: need.foundInRaid,
          label: need.label ?? null,
          accepted: Math.max(need.alternatives ?? 0, need.items.length),
        });
      }
    }
    if (count > 0 || anyOf.length > 0) needed.push({ ...named(quest), count, foundInRaid, anyOf });

    const maps = quest.keys.filter((entry) => entry.keys.includes(itemId)).map((entry) => entry.map);
    if (maps.length > 0) {
      const names = new Set(maps.flatMap((map) => (map ? [baseMapName(map, list.maps)] : [])));
      keys.push({ ...named(quest), maps: Array.from(names) });
    }
  }
  needed.sort((a, b) => Number(a.count === 0) - Number(b.count === 0) || byProgression(a, b));
  keys.sort(byProgression);
  return { needed, keys };
}
