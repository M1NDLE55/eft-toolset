import { normalizeText } from "@/app/lib/search/normalize-text";
import type { QuestState, QuestStatus } from "./availability";
import type { QuestList, QuestSummary } from "./types";

export interface QuestFilter {
  /** Matches the quest's name, its trader, or the name of an item it needs. */
  text?: string;
  trader?: string | null;
  /** A map key or a page key; a page key also matches its variants (factory matches night-factory). */
  map?: string | null;
  minLevel?: number | null;
  maxLevel?: number | null;
  kappa?: boolean;
  lightkeeper?: boolean;
  /** Only quests that need items found in raid. */
  foundInRaid?: boolean;
  /** Only quests in these states; needs the statuses. */
  states?: readonly QuestState[];
  /** Leave out quests only for the other faction; needs the statuses. */
  ownFaction?: boolean;
}

type Lookup = Pick<QuestList, "items" | "maps">;

export function matchesText(quest: QuestSummary, text: string, lookup: Lookup) {
  const query = normalizeText(text);
  if (!query) return true;
  const matches = (value: string | null | undefined) => Boolean(value && normalizeText(value).includes(query));
  return (
    matches(quest.name) ||
    matches(quest.trader) ||
    quest.needs.some((need) =>
      need.items.some((id) => matches(lookup.items[id]?.name) || matches(lookup.items[id]?.shortName))
    )
  );
}

export function questMatches(quest: QuestSummary, filter: QuestFilter, lookup: Lookup, status?: QuestStatus) {
  if (filter.trader && quest.trader !== filter.trader) return false;
  if (filter.map && !quest.maps.some((key) => key === filter.map || lookup.maps[key]?.page === filter.map)) return false;
  if (typeof filter.minLevel === "number" && quest.minPlayerLevel < filter.minLevel) return false;
  if (typeof filter.maxLevel === "number" && quest.minPlayerLevel > filter.maxLevel) return false;
  if (filter.kappa && !quest.kappaRequired) return false;
  if (filter.lightkeeper && !quest.lightkeeperRequired) return false;
  if (filter.foundInRaid && !quest.needs.some((need) => need.foundInRaid)) return false;
  if (filter.states && (!status || !filter.states.includes(status.state))) return false;
  if (filter.ownFaction && status?.otherFaction) return false;
  return filter.text ? matchesText(quest, filter.text, lookup) : true;
}

export function filterQuests(
  list: QuestList,
  filter: QuestFilter,
  statuses?: ReadonlyMap<string, QuestStatus>
): QuestSummary[] {
  return list.quests.filter((quest) => questMatches(quest, filter, list, statuses?.get(quest.id)));
}
