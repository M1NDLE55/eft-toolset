import { getTaskIndex } from "@/app/lib/api/tarkov-server";
import type { BuildSource, PartLookup } from "@/app/lib/builds/resolve";
import { hasTraderLimits, withBarterPrices, withTraderLimits, type TraderLimits } from "@/app/lib/builds/price";
import { presetParts, type PurchaseContext } from "@/app/lib/builds/purchase";
import { expandCompleted, matchTasks, type TaskIndex } from "@/app/lib/builds/quests";
import type { CatalogItem } from "@/app/lib/cache/types";
import { suggestNames } from "@/app/lib/search/filter-catalog";
import type { PresetContents, PriceSources } from "@/app/lib/types/gunBuilder";
import { InputError, type GameMode, type Read } from "./context";
import { loadBuildSource } from "./sources";

export interface PriceInput extends PriceSources {
  maxTraderLevel?: number;
  traderLevels?: Record<string, number>;
  excludeQuestLocked?: boolean;
  completedTasks?: string[];
}

export interface QuestProgress {
  tasks: TaskIndex;
  /** Ids of the completed tasks and the tasks they required. */
  completed: ReadonlySet<string>;
}

export interface BuildPricing {
  data: BuildSource;
  sources: PriceSources;
  limits: TraderLimits | null;
  quests: QuestProgress;
}

const MAX_LIMITED_LOOKUPS = 16;
const MAX_UNKNOWN_TASKS_LISTED = 5;
const limitedLookups = new WeakMap<PartLookup, Map<string, PartLookup>>();
const taskCatalogs = new WeakMap<TaskIndex, CatalogItem[]>();

function traderNames(lookup: PartLookup) {
  const names = new Map<string, string>();
  for (const item of lookup.values()) {
    for (const offer of item.traderOffers ?? []) names.set(offer.trader.toLowerCase(), offer.trader);
  }
  return names;
}

function parseLevels(input: PriceInput, lookup: PartLookup) {
  const known = traderNames(lookup);
  const levels: Record<string, number> = {};
  for (const [name, level] of Object.entries(input.traderLevels ?? {})) {
    const key = name.trim().toLowerCase();
    if (!known.has(key)) {
      throw new InputError(
        `traderLevels has an unknown trader "${name}". Traders: ${[...known.values()].sort().join(", ")}.`
      );
    }
    levels[key] = level;
  }
  return levels;
}

function taskCatalog(tasks: TaskIndex) {
  let catalog = taskCatalogs.get(tasks);
  if (!catalog) {
    catalog = [...tasks.values()].map((task) => ({
      id: task.id,
      name: task.name,
      shortName: null,
      normalizedName: task.normalizedName,
      gridImageLink: null,
    }));
    taskCatalogs.set(tasks, catalog);
  }
  return catalog;
}

function parseCompletedTasks(names: readonly string[], tasks: TaskIndex): Set<string> {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const matches = matchTasks(tasks, name);
    if (matches.length) ids.push(...matches);
    else unknown.push(name);
  }
  if (unknown.length) {
    const described = unknown.slice(0, MAX_UNKNOWN_TASKS_LISTED).map((name) => {
      const close = suggestNames(taskCatalog(tasks), name, 3);
      return `"${name}"${close.length ? ` (did you mean ${close.map((task) => `"${task}"`).join(" or ")}?)` : ""}`;
    });
    const more = unknown.length - described.length;
    throw new InputError(
      `completedTasks has ${unknown.length === 1 ? "an unknown task" : "unknown tasks"}: ${described.join(", ")}${more > 0 ? `, and ${more} more` : ""}. Give tasks by their full name, such as "Chemical - Part 2", or id.`
    );
  }
  return expandCompleted(tasks, ids);
}

function limitItem<T extends Parameters<typeof withTraderLimits>[0]>(item: T, limits: TraderLimits | null, sources: PriceSources) {
  const limited = hasTraderLimits(limits) ? withTraderLimits(item, limits) : item;
  return sources.barters ? withBarterPrices(limited, sources, limits) : limited;
}

function limitLookup(lookup: PartLookup, limits: TraderLimits | null, sources: PriceSources): PartLookup {
  let byKey = limitedLookups.get(lookup);
  if (!byKey) {
    byKey = new Map();
    limitedLookups.set(lookup, byKey);
  }
  const key = JSON.stringify([
    limits?.maxLevel,
    Object.entries(limits?.levels ?? {}).sort(),
    // Completed tasks only change prices when quest-locked offers are left out.
    limits?.excludeQuestLocked ? [...(limits.completedTasks ?? [])].sort() : null,
    sources.barters ? [sources.traders, sources.flea] : null,
  ]);
  const cached = byKey.get(key);
  if (cached) return cached;
  const limited = new Map(Array.from(lookup, ([id, item]) => [id, limitItem(item, limits, sources)]));
  if (byKey.size >= MAX_LIMITED_LOOKUPS) byKey.delete(byKey.keys().next().value!);
  byKey.set(key, limited);
  return limited;
}

export async function loadBuildPricing(read: Read, gameMode: GameMode, input: PriceInput): Promise<BuildPricing> {
  const [source, tasks] = await Promise.all([
    loadBuildSource(read, gameMode),
    read(() => getTaskIndex(gameMode)),
  ]);
  const sources = { traders: input.traders, flea: input.flea, barters: input.barters === true };
  const completed = parseCompletedTasks(input.completedTasks ?? [], tasks);
  const quests = { tasks, completed };
  const limits: TraderLimits = {
    maxLevel: input.maxTraderLevel ?? null,
    levels: parseLevels(input, source.lookup),
    excludeQuestLocked: input.excludeQuestLocked === true,
    completedTasks: completed,
  };
  const limited = hasTraderLimits(limits) ? limits : null;
  if (!limited && !sources.barters) return { data: source, sources, limits: null, quests };
  return {
    data: {
      ...source,
      lookup: limitLookup(source.lookup, limited, sources),
      loadAmmo: async (ids) => (await source.loadAmmo(ids)).map((ammo) => limitItem(ammo, limited, sources)),
    },
    sources,
    limits: limited,
    quests,
  };
}

/** The weapon's default preset contents, or null when it has none or they can't be loaded. */
export async function defaultPreset(data: BuildSource, weaponId: string): Promise<PresetContents | null> {
  const presetId = data.lookup.get(weaponId)?.defaultPresetId;
  return presetId ? data.loadPreset(presetId) : null;
}

/** How a build of this weapon is priced: the trader limits, and the parts its default preset comes with. */
export async function purchaseContext({ data, limits }: BuildPricing, weaponId: string): Promise<PurchaseContext> {
  return { limits, preset: presetParts(weaponId, await defaultPreset(data, weaponId)) };
}
