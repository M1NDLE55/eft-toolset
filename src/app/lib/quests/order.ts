import type { QuestRequirement } from "./types";

/** Traders in the order the game lists them. Any others follow, in tarkov.dev's order. */
export const TRADER_ORDER = [
  "Prapor",
  "Therapist",
  "Fence",
  "Skier",
  "Peacekeeper",
  "Mechanic",
  "Ragman",
  "Jaeger",
  "Ref",
  "Lightkeeper",
  "BTR Driver",
] as const;

const RANK: ReadonlyMap<string, number> = new Map(TRADER_ORDER.map((name, index) => [name, index]));

/** `traders` in the game's order: the known ones by TRADER_ORDER, then the rest as given. */
export function orderTraders(traders: readonly string[]): string[] {
  const unique = Array.from(new Set(traders));
  const position = new Map(unique.map((name, index) => [name, index]));
  const rank = (name: string) => RANK.get(name) ?? TRADER_ORDER.length + position.get(name)!;
  return unique.toSorted((a, b) => rank(a) - rank(b));
}

interface Orderable {
  id: string;
  name: string;
  trader: string | null;
  minPlayerLevel: number;
  requires: readonly QuestRequirement[];
}

/**
 * Level 0 and 1 both mean open from the start. Then the id: the game's ids begin with the time the quest was
 * made, and a trader's line was written in the order it's played, so older quests come first (Debut before
 * Background Check before Shootout Picnic). That holds where tarkov.dev lists neither a level nor a prerequisite.
 */
function byLevelThenAge(a: Orderable, b: Orderable) {
  return Math.max(a.minPlayerLevel, 1) - Math.max(b.minPlayerLevel, 1) || compare(a.id, b.id) || compare(a.name, b.name);
}

function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Quests grouped by trader in `traders`' order (others, then those with no trader, last), and within a trader
 * in the order you'd do them: lowest level first, but never before a quest of the same trader it needs. Of the
 * quests whose prerequisites have all come, the lowest level (then the oldest) goes next.
 */
export function orderQuests<T extends Orderable>(quests: readonly T[], traders: readonly string[]): T[] {
  const groups = new Map<string | null, T[]>();
  for (const quest of quests) groups.set(quest.trader, [...(groups.get(quest.trader) ?? []), quest]);
  const rank = new Map(traders.map((name, index) => [name, index]));
  const order = Array.from(groups.keys()).toSorted((a, b) => {
    const rankA = a === null ? Infinity : (rank.get(a) ?? traders.length);
    const rankB = b === null ? Infinity : (rank.get(b) ?? traders.length);
    return rankA - rankB || (a ?? "").localeCompare(b ?? "");
  });
  return order.flatMap((trader) => byProgression(groups.get(trader)!));
}

function byProgression<T extends Orderable>(quests: readonly T[]): T[] {
  const ids = new Set(quests.map((quest) => quest.id));
  const waitingOn = new Map(
    quests.map((quest) => [quest.id, new Set(quest.requires.map((entry) => entry.id).filter((id) => ids.has(id) && id !== quest.id))])
  );
  const left = quests.toSorted(byLevelThenAge);
  const result: T[] = [];
  while (left.length > 0) {
    // A cycle in the data leaves nothing ready: take the lowest level left rather than stall.
    const index = Math.max(0, left.findIndex((quest) => waitingOn.get(quest.id)!.size === 0));
    const [next] = left.splice(index, 1);
    result.push(next);
    for (const quest of left) waitingOn.get(quest.id)!.delete(next.id);
  }
  return result;
}
