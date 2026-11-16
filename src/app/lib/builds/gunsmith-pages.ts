import {
  getGunPartLookup,
  getItemCategories,
  getItemFacets,
  getPreset,
  getWeaponBuildTasks,
  type WeaponBuildTask,
} from "@/app/lib/api/tarkov-server";
import type { GameMode } from "@/components/game-mode/mode";
import { isItemSlug } from "@/app/lib/item-links";
import { BEST_BUILD_PRICES, OptimizerBusyError, describeBuild, type DescribedBuild } from "./best-builds";
import { solveGunsmith, type GunsmithContext, type RequirementCheck } from "./gunsmith";
import { releaseOptimizerSlot, tryAcquireOptimizerSlot } from "./optimizer-slots";
import { reconstructPresetTree } from "./presets";
import { presetParts } from "./purchase";
import type { PartLookup } from "./resolve";

export interface GunsmithTaskSummary {
  slug: string;
  name: string;
  trader: string | null;
  minPlayerLevel: number;
  faction: string | null;
  weapons: string[];
  /** Gunsmith Master parts, the per-weapon Gunsmith tasks, or other tasks that need a build. */
  group: "master" | "weapon" | "other";
  /** For ordering Gunsmith Master parts: the part number. */
  part: number | null;
}

export interface NamedLink {
  name: string;
  slug: string | null;
}

export interface GunsmithObjectiveView {
  weapon: NamedLink & { id: string; shortName: string; gridImageLink: string | null };
  requiredParts: NamedLink[];
  requiredCategories: string[];
  checks: RequirementCheck[];
  /** A build that passes every check the data can make, or null. */
  build: DescribedBuild | null;
  /** The preset with the required parts installed, to start from in the gun builder. */
  start: DescribedBuild;
  /** Without a build: required parts and categories the closest attempt still lacks. */
  missingParts: string[];
  missingCategories: string[];
}

export interface GunsmithTaskView {
  task: Omit<WeaponBuildTask, "objectives"> & { slug: string };
  gameMode: GameMode;
  objectives: GunsmithObjectiveView[];
}

function summarize(task: WeaponBuildTask, lookup: PartLookup): GunsmithTaskSummary {
  const master = /^Gunsmith Master - Part (\d+)/i.exec(task.name);
  return {
    slug: task.normalizedName,
    name: task.name,
    trader: task.trader,
    minPlayerLevel: task.minPlayerLevel,
    faction: task.faction,
    weapons: task.objectives.map((objective) => lookup.get(objective.weaponId)?.shortName ?? "Weapon"),
    group: master ? "master" : /^Gunsmith\b/i.test(task.name) ? "weapon" : "other",
    part: master ? Number(master[1]) : null,
  };
}

const GROUP_ORDER = { master: 0, weapon: 1, other: 2 } as const;

export async function listGunsmithTasks(gameMode: GameMode): Promise<GunsmithTaskSummary[]> {
  const [tasks, lookup] = await Promise.all([getWeaponBuildTasks(gameMode), getGunPartLookup(gameMode)]);
  return tasks
    .filter((task) => isItemSlug(task.normalizedName))
    .map((task) => summarize(task, lookup))
    .sort(
      (a, b) =>
        GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || (a.part ?? 0) - (b.part ?? 0) || a.name.localeCompare(b.name)
    );
}

function link(lookup: PartLookup, id: string): NamedLink {
  const item = lookup.get(id);
  const slug = item?.normalizedName && isItemSlug(item.normalizedName) ? item.normalizedName : null;
  return { name: item?.name ?? id, slug };
}

async function computeTask(gameMode: GameMode, task: WeaponBuildTask): Promise<GunsmithTaskView> {
  const [lookup, facets, categories] = await Promise.all([
    getGunPartLookup(gameMode),
    getItemFacets(gameMode),
    getItemCategories(gameMode),
  ]);
  const inCategory = (itemId: string, categoryId: string) => {
    const category = categories.get(categoryId);
    return Boolean(category && facets.byId.get(itemId)?.categories.includes(category.normalizedName));
  };
  const objectives: GunsmithObjectiveView[] = [];
  for (const objective of task.objectives) {
    const weapon = lookup.get(objective.weaponId);
    if (!weapon) continue;
    const presetId = weapon.defaultPresetId;
    const contents = presetId ? await getPreset(gameMode, presetId) : null;
    const preset = presetParts(weapon.id, contents, lookup);
    const context: GunsmithContext = { lookup, sources: BEST_BUILD_PRICES, inCategory, preset };
    const presetRoot = contents ? reconstructPresetTree(weapon.id, contents, lookup) : null;
    if (!tryAcquireOptimizerSlot()) throw new OptimizerBusyError();
    let solution;
    try {
      solution = await solveGunsmith(objective, presetRoot, context);
    } finally {
      releaseOptimizerSlot();
    }
    const pricing = { limits: null, preset };
    const label = task.objectives.length > 1 ? `${task.name} (${weapon.shortName})` : task.name;
    objectives.push({
      weapon: { ...link(lookup, weapon.id), id: weapon.id, shortName: weapon.shortName, gridImageLink: weapon.gridImageLink },
      requiredParts: objective.containsAll.map((id) => link(lookup, id)),
      requiredCategories: objective.containsCategory.map((id) => categories.get(id)?.name ?? id),
      checks: solution.check.checks,
      build: solution.build ? await describeBuild(label, solution.build, lookup, pricing) : null,
      start: await describeBuild(`${label} (start)`, solution.start, lookup, pricing),
      missingParts: solution.check.missingParts.map((id) => lookup.get(id)?.name ?? id),
      missingCategories: solution.check.missingCategories.map((id) => categories.get(id)?.name ?? id),
    });
  }
  const { objectives: _objectives, ...rest } = task;
  return { task: { ...rest, slug: task.normalizedName }, gameMode, objectives };
}

const CACHE_TTL_MS = 60 * 60_000;
const cache = new Map<string, { at: number; lookup: PartLookup; value: Promise<GunsmithTaskView> }>();

/** One task's requirements and solved builds, kept for an hour per instance. */
export async function getGunsmithTask(gameMode: GameMode, slug: string): Promise<GunsmithTaskView | null> {
  const task = (await getWeaponBuildTasks(gameMode)).find((entry) => entry.normalizedName === slug);
  if (!task) return null;
  const lookup = await getGunPartLookup(gameMode);
  const key = `${gameMode}/${slug}`;
  const cached = cache.get(key);
  if (cached && cached.lookup === lookup && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const value = computeTask(gameMode, task);
  cache.set(key, { at: Date.now(), lookup, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}
