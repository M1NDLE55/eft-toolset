import type { QuestGraph } from "./graph";
import type { Faction, QuestMap, RequirementStatus } from "./types";

/** A quest's name, told apart from others that share it by its prestige level (New Beginning). */
export function questName(quest: { name: string; prestige?: number | null }) {
  return quest.prestige ? `${quest.name} (Prestige ${quest.prestige})` : quest.name;
}

/** The name with its faction, for titles where no badge can say it. */
export function questTitleName(quest: { name: string; prestige?: number | null; faction: Faction | null }) {
  return quest.faction ? `${questName(quest)} (${quest.faction})` : questName(quest);
}

/** What a requirement asks of the other quest, as a short phrase. */
export function requirementLabel(status: readonly RequirementStatus[]) {
  const complete = status.includes("complete");
  const active = status.includes("active");
  const failed = status.includes("failed");
  if (complete && failed) return "complete or fail";
  if (complete && active) return "start or complete";
  if (complete) return "complete";
  if (active) return "start";
  return "fail";
}

/** "Level 15" for a level requirement; nothing for quests open from the start. */
export function levelLabel(level: number) {
  return level > 1 ? `Level ${level}` : null;
}

/**
 * For an objective that names its one item ("Hand over the found in raid item: Salewa"), the
 * words before and after the name, so the name can link to the item; null when it isn't named.
 */
export function aroundItemName(description: string, name: string | null | undefined) {
  if (!name) return null;
  const at = description.lastIndexOf(name);
  if (at < 0) return null;
  return { before: description.slice(0, at), after: description.slice(at + name.length) };
}

const hintCache = new WeakMap<QuestGraph, ReadonlyMap<string, string>>();

/**
 * A few words telling apart quests that share a name and faction (Battery Change, The Tarkov
 * Shooter - Part 5): what they follow, else their map, else their level, whichever differs for
 * each of them; else which copy they are, in list order. Quests with a name of their own get none.
 */
export function sameNameHints(graph: QuestGraph, maps: Readonly<Record<string, QuestMap>>): ReadonlyMap<string, string> {
  const cached = hintCache.get(graph);
  if (cached) return cached;
  const groups = new Map<string, QuestGraph["quests"][number][]>();
  for (const quest of graph.quests) {
    const key = `${questName(quest)}\u0000${quest.faction ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), quest]);
  }
  const hints = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ways = [
      (quest: (typeof group)[number]) => {
        const names = quest.requires.flatMap((entry) => {
          const other = graph.byId.get(entry.id);
          return other ? [questName(other)] : [];
        });
        return names.length > 0 ? `after ${names.slice().sort().join(", ")}` : "";
      },
      (quest: (typeof group)[number]) => (quest.maps[0] ? `on ${maps[quest.maps[0]]?.name ?? quest.maps[0]}` : ""),
      (quest: (typeof group)[number]) => (quest.minPlayerLevel > 1 ? `level ${quest.minPlayerLevel}` : ""),
    ];
    const way = ways.find((hint) => {
      const values = group.map(hint);
      return values.every(Boolean) && new Set(values).size === values.length;
    });
    group.forEach((quest, index) => hints.set(quest.id, way ? way(quest) : `copy ${index + 1} of ${group.length}`));
  }
  hintCache.set(graph, hints);
  return hints;
}

/**
 * From this many maps (variants merged), a quest or objective works on nearly every raid: it says "Any map"
 * rather than listing them. Ten maps make up the usual rotation, and quests either name a few or most of them.
 */
export const ANY_MAP_FROM = 8;

/**
 * The game's maps by raid planner page key (or their own key, without a page), so a variant is named after its
 * base map even when a list carries only the variant.
 */
export const MAP_NAMES: Readonly<Record<string, string>> = {
  customs: "Customs",
  factory: "Factory",
  woods: "Woods",
  shoreline: "Shoreline",
  interchange: "Interchange",
  reserve: "Reserve",
  "the-lab": "The Lab",
  lighthouse: "Lighthouse",
  "streets-of-tarkov": "Streets of Tarkov",
  "ground-zero": "Ground Zero",
  "the-labyrinth": "The Labyrinth",
  terminal: "Terminal",
  icebreaker: "Icebreaker",
};

/** A map's name, or for a variant (Night Factory) its base map's. */
export function baseMapName(key: string, maps: Readonly<Record<string, QuestMap>>): string {
  const map = maps[key];
  const page = map?.page;
  return (page && (maps[page]?.name || MAP_NAMES[page])) || map?.name || key;
}
export const ANY_MAP = "Any map";

/**
 * Map names for a quest or objective: variants (Night Factory, Ground Zero 21+, The Lab (Dark)) merge into the map
 * whose page they share, as the Map filter groups them, and a list of most maps is just "Any map".
 */
export function mapLabels(keys: readonly string[], maps: Readonly<Record<string, QuestMap>>): string[] {
  const names = new Map<string, string>();
  for (const key of keys) {
    const base = maps[key]?.page ?? key;
    if (!names.has(base)) names.set(base, baseMapName(key, maps));
  }
  return names.size >= ANY_MAP_FROM ? [ANY_MAP] : Array.from(names.values());
}
