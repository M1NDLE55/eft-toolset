import type { BuildNode, BuildItemData, PriceSources } from "@/app/lib/types/gunBuilder";
import type { WeaponBuildObjective, WeaponBuildRequirement } from "@/app/lib/api/tarkov-server";
import { optimizeBuild, type OptimizeGoal, type ScoreBlend } from "./optimizer";
import { effectivePrice } from "./price";
import type { PresetParts } from "./purchase";
import type { PartLookup } from "./resolve";
import { installedMagazineCapacity, isMagazineSlot } from "./sights";
import { computeStats } from "./stats";
import { carryOverChildren } from "./tree";

// Solving and checking weapon-build tasks (Gunsmith): stat limits, required parts and part categories.

export type CheckStatus = "pass" | "fail" | "unknown";

export interface RequirementCheck {
  name: string;
  label: string;
  compareMethod: WeaponBuildRequirement["compareMethod"];
  value: number;
  unit: string;
  /** The build's value, when the data can tell. */
  actual: number | null;
  status: CheckStatus;
}

export interface GunsmithContext {
  lookup: PartLookup;
  sources: PriceSources;
  /** Whether an item is in a tarkov.dev item category (by the category's id). */
  inCategory(itemId: string, categoryId: string): boolean;
  preset: PresetParts | null;
}

const LABELS: Record<string, { label: string; unit: string }> = {
  ergonomics: { label: "Ergonomics", unit: "" },
  recoil: { label: "Recoil sum (vertical + horizontal)", unit: "" },
  weight: { label: "Weight", unit: " kg" },
  magazineCapacity: { label: "Magazine capacity", unit: " rounds" },
  effectiveDistance: { label: "Sighting range", unit: " m" },
  durability: { label: "Durability", unit: "%" },
  width: { label: "Width", unit: " cells" },
  height: { label: "Height", unit: " cells" },
  accuracy: { label: "Accuracy", unit: "" },
  muzzleVelocity: { label: "Muzzle velocity", unit: " m/s" },
};

export function requirementLabel(name: string) {
  return LABELS[name] ?? { label: name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()), unit: "" };
}

function walkNodes(root: BuildNode, visit: (node: BuildNode, path: string[]) => void, path: string[] = []) {
  visit(root, path);
  for (const [slotId, child] of Object.entries(root.slots)) walkNodes(child, visit, [...path, slotId]);
}

/** The longest sighting range among the weapon and its installed sights. */
export function sightingRange(root: BuildNode, lookup: PartLookup): number | null {
  let best: number | null = null;
  walkNodes(root, (node) => {
    const range = lookup.get(node.itemId)?.sightingRange;
    if (typeof range === "number") best = Math.max(best ?? 0, range);
  });
  return best;
}

function compare(actual: number, rule: WeaponBuildRequirement) {
  // Stats shown in game are rounded, so allow for the last decimal.
  if (rule.compareMethod === ">=") return actual >= rule.value - 1e-6;
  if (rule.compareMethod === "<=") return actual <= rule.value + 1e-6;
  return Math.abs(actual - rule.value) < 1e-6;
}

export function checkRequirements(root: BuildNode, objective: WeaponBuildObjective, context: GunsmithContext) {
  const stats = computeStats(root, context.lookup, context.sources, null, { preset: context.preset });
  const values: Record<string, number | null> = {
    ergonomics: stats.ergonomics,
    recoil: stats.recoilVertical === null || stats.recoilHorizontal === null ? null : stats.recoilVertical + stats.recoilHorizontal,
    weight: stats.weight,
    magazineCapacity: installedMagazineCapacity(root, context.lookup) ?? 0,
    effectiveDistance: sightingRange(root, context.lookup),
  };
  const checks: RequirementCheck[] = objective.requirements.map((rule) => {
    const { label, unit } = requirementLabel(rule.name);
    const actual = rule.name in values ? values[rule.name] : null;
    return {
      ...rule,
      label,
      unit,
      actual: actual === null ? null : Math.round(actual * 100) / 100,
      status: actual === null ? "unknown" : compare(actual, rule) ? "pass" : "fail",
    };
  });
  const installed = new Set<string>();
  walkNodes(root, (node) => installed.add(node.itemId));
  const missingParts = objective.containsAll.filter((id) => !installed.has(id));
  const missingCategories = objective.containsCategory.filter(
    (category) => ![...installed].some((id) => id !== root.itemId && context.inCategory(id, category))
  );
  const passes =
    checks.every((check) => check.status !== "fail") && missingParts.length === 0 && missingCategories.length === 0;
  return { checks, missingParts, missingCategories, passes, stats };
}

interface Placement {
  parentPath: string[];
  slotId: string;
  occupied: BuildNode | undefined;
}

function attach(root: BuildNode, place: Placement, node: BuildNode): BuildNode {
  const update = (current: BuildNode, path: string[]): BuildNode =>
    path.length === 0
      ? { ...current, slots: { ...current.slots, [place.slotId]: node } }
      : { ...current, slots: { ...current.slots, [path[0]]: update(current.slots[path[0]], path.slice(1)) } };
  return update(root, place.parentPath);
}

/** Which parts can hold each part: the reverse of every slot's allowed items. */
function parentIndex(lookup: PartLookup) {
  const parents = new Map<string, Set<string>>();
  for (const item of lookup.values()) {
    for (const slot of item.slots ?? []) {
      for (const id of slot.allowedItemIds) {
        let set = parents.get(id);
        if (!set) parents.set(id, (set = new Set()));
        set.add(item.id);
      }
    }
  }
  return parents;
}

const parentIndexes = new WeakMap<PartLookup, Map<string, Set<string>>>();

function parentsOf(lookup: PartLookup, id: string) {
  let index = parentIndexes.get(lookup);
  if (!index) parentIndexes.set(lookup, (index = parentIndex(lookup)));
  return index.get(id) ?? new Set<string>();
}

/** Which limits the task sets, so placement can prefer light, low-recoil or ergonomic parts. */
export interface Priorities {
  weight: boolean;
  recoil: boolean;
  ergonomics: boolean;
}

function partScore(item: BuildItemData, price: number, priorities: Priorities) {
  return (
    price / 20_000 +
    item.weight * (priorities.weight ? 20 : 1) +
    item.recoilModifier * 100 * (priorities.recoil ? 1 : 0.1) -
    item.ergonomics * (priorities.ergonomics ? 0.5 : 0.05)
  );
}

const MAX_CHAIN = 4;

/**
 * Installs one of the target parts, with the parts it needs to hang from (up to three), in the
 * slot where that costs the least by the task's priorities. Locked parts are never replaced.
 * Returns null when no chain of buyable parts can carry a target.
 */
export function placeOneOf(
  root: BuildNode,
  context: GunsmithContext,
  targets: ReadonlySet<string>,
  locked: Set<string>,
  priorities: Priorities,
  /** Required parts go in even when they can't be bought: the task needs them anyway. */
  targetsRequired = false,
  /** Longest chain of parts to install: 1 puts a target straight into a slot. */
  maxChain = MAX_CHAIN
): BuildNode | null {
  const { lookup, sources } = context;
  const score = (id: string, required = false) => {
    const item = lookup.get(id) as BuildItemData | undefined;
    if (!item) return null;
    const price = effectivePrice(item, sources);
    if (price === null) return required ? partScore(item, 0, priorities) + 50 : null;
    return partScore(item, price, priorities);
  };
  // Best chain from each part down to a target: [part, ..., target], by total score.
  const chains = new Map<string, { ids: string[]; score: number }>();
  let frontier = new Map<string, { ids: string[]; score: number }>();
  for (const id of targets) {
    const own = score(id, targetsRequired);
    if (own !== null) frontier.set(id, { ids: [id], score: own });
  }
  for (let depth = 0; depth < maxChain && frontier.size > 0; depth++) {
    const next = new Map<string, { ids: string[]; score: number }>();
    for (const [id, chain] of frontier) {
      const known = chains.get(id);
      if (known && known.score <= chain.score) continue;
      chains.set(id, chain);
      if (depth === maxChain - 1) continue;
      for (const parent of parentsOf(lookup, id)) {
        const own = score(parent);
        if (own === null || chain.ids.includes(parent)) continue;
        const candidate = { ids: [parent, ...chain.ids], score: own + chain.score };
        const seen = next.get(parent);
        if (!seen || candidate.score < seen.score) next.set(parent, candidate);
      }
    }
    frontier = next;
  }
  let best = null as { place: Placement; ids: string[]; score: number } | null;
  walkNodes(root, (node, path) => {
    for (const slot of (lookup.get(node.itemId) as BuildItemData | undefined)?.slots ?? []) {
      const occupied = node.slots[slot.id];
      if (occupied && holdsLocked(occupied, locked)) continue;
      for (const id of slot.allowedItemIds) {
        const chain = chains.get(id);
        // Replacing a part costs a little, so empty slots win ties.
        const total = chain ? chain.score + (occupied ? 0.5 : 0) : null;
        if (chain && total !== null && (!best || total < best.score)) {
          best = { place: { parentPath: path, slotId: slot.id, occupied }, ids: chain.ids, score: total };
        }
      }
    }
  });
  if (!best) return null;
  // Build the chain from the target up; the top part keeps what it replaces where it fits.
  let node: BuildNode | null = null;
  for (const id of [...best.ids].reverse()) {
    const item = lookup.get(id) as BuildItemData;
    if (!node) {
      node = { itemId: id, slots: {} };
      continue;
    }
    const child: BuildNode = node;
    const slot = item.slots.find((entry) => entry.allowedItemIds.includes(child.itemId));
    node = { itemId: id, slots: slot ? { [slot.id]: child } : {} };
  }
  const top = best.place.occupied
    ? mergeInto(node!, carryOverChildren(best.place.occupied, lookup.get(best.place.occupied.itemId) as BuildItemData, lookup.get(node!.itemId) as BuildItemData))
    : node!;
  for (const id of best.ids) locked.add(id);
  return attach(root, best.place, top);
}

/** Whether a part, or anything attached to it, is locked: replacing it would lose them. */
function holdsLocked(node: BuildNode, locked: ReadonlySet<string>): boolean {
  return locked.has(node.itemId) || Object.values(node.slots).some((child) => holdsLocked(child, locked));
}

/** The new chain's slots win; the replaced part's children fill the slots the chain leaves empty. */
function mergeInto(chain: BuildNode, carried: BuildNode): BuildNode {
  return { itemId: chain.itemId, slots: { ...carried.slots, ...chain.slots } };
}

/** Installs the required parts, with any parts they need to hang from. */
export function placeRequiredParts(
  root: BuildNode,
  context: GunsmithContext,
  ids: readonly string[],
  locked: Set<string>,
  priorities: Priorities
) {
  let current = root;
  let pending = ids.filter((id) => context.lookup.has(id));
  for (const id of pending) {
    if (containsItem(current, id)) locked.add(id);
  }
  pending = pending.filter((id) => !locked.has(id));
  // Parts that fit straight into the build go first, so a part another one hangs from (a
  // required handguard under a required foregrip) is in place before chains are looked for.
  for (const maxChain of [1, MAX_CHAIN]) {
    for (let round = 0; round < 4 && pending.length > 0; round++) {
      const next: string[] = [];
      for (const id of pending) {
        const placed = placeOneOf(current, context, new Set([id]), locked, priorities, true, maxChain);
        if (placed) current = placed;
        else next.push(id);
      }
      if (next.length === pending.length) break;
      pending = next;
    }
  }
  return { root: current, unplaced: pending };
}

function containsItem(root: BuildNode, id: string) {
  let found = false;
  walkNodes(root, (node) => {
    if (node.itemId === id) found = true;
  });
  return found;
}

/** Parts in the lookup that pass a test and can be bought. */
function buyable(context: GunsmithContext, test: (item: BuildItemData) => boolean) {
  const ids = new Set<string>();
  for (const item of context.lookup.values()) {
    if (!item.isWeapon && test(item) && effectivePrice(item, context.sources) !== null) ids.add(item.id);
  }
  return ids;
}

/** The build trimmed to the locked parts and the parts that hold them, for the optimiser to fill in. */
export function skeleton(root: BuildNode, locked: ReadonlySet<string>): BuildNode {
  const keep = (node: BuildNode): BuildNode | null => {
    const slots: Record<string, BuildNode> = {};
    for (const [slotId, child] of Object.entries(node.slots)) {
      const kept = keep(child);
      if (kept) slots[slotId] = kept;
    }
    return locked.has(node.itemId) || Object.keys(slots).length > 0 ? { itemId: node.itemId, slots } : null;
  };
  return { itemId: root.itemId, slots: keep(root)?.slots ?? {} };
}

function pickSmallMagazine(root: BuildNode, context: GunsmithContext, max: number, locked: Set<string>) {
  const { lookup, sources } = context;
  let best = null as { place: Placement; id: string; ergonomics: number } | null;
  walkNodes(root, (node, path) => {
    for (const slot of (lookup.get(node.itemId) as BuildItemData | undefined)?.slots ?? []) {
      if (!isMagazineSlot(slot)) continue;
      for (const id of slot.allowedItemIds) {
        const item = lookup.get(id) as BuildItemData | undefined;
        if (!item || typeof item.capacity !== "number" || item.capacity > max || effectivePrice(item, sources) === null) continue;
        if (!best || item.ergonomics > best.ergonomics) best = { place: { parentPath: path, slotId: slot.id, occupied: node.slots[slot.id] }, id, ergonomics: item.ergonomics };
      }
    }
  });
  if (!best) return root;
  locked.add(best.id);
  return attach(root, best.place, { itemId: best.id, slots: {} });
}

export interface GunsmithSolution {
  /** The preset with the required parts installed: a starting point even without a full solution. */
  start: BuildNode;
  /** A build that passes every requirement the data can check, or null. */
  build: BuildNode | null;
  goal: OptimizeGoal | null;
  check: ReturnType<typeof checkRequirements>;
  /** Required parts that couldn't be fitted. */
  unplaced: string[];
}

/** Score mixes to try: each goal alone, then mixes for tasks with several limits. */
const ATTEMPTS: { goal: OptimizeGoal; blend: ScoreBlend | null }[] = [
  { goal: "ergonomics", blend: null },
  { goal: "recoil", blend: null },
  { goal: "cost", blend: null },
  { goal: "recoil", blend: { ergonomics: 1, recoil: 1, weight: 0 } },
  { goal: "recoil", blend: { ergonomics: 1, recoil: 1, weight: 20 } },
  { goal: "recoil", blend: { ergonomics: 0.3, recoil: 1, weight: 20 } },
  { goal: "recoil", blend: { ergonomics: 1, recoil: 0.3, weight: 20 } },
  { goal: "recoil", blend: { ergonomics: 0.1, recoil: 0.1, weight: 100 } },
];

/** How far a check misses, as a fraction of its limit; 0 when it passes or can't be told. */
function shortfall(check: RequirementCheck) {
  if (check.status !== "fail" || check.actual === null) return 0;
  return Math.abs(check.actual - check.value) / Math.max(Math.abs(check.value), 1);
}

function missScore(check: ReturnType<typeof checkRequirements>) {
  return (
    check.missingParts.length * 10 +
    check.missingCategories.length * 10 +
    check.checks.reduce((total, entry) => total + (entry.status === "fail" ? 1 + shortfall(entry) : 0), 0)
  );
}

/**
 * Looks for a build that meets the task: install the required parts, a part from each required
 * category, a sight that reaches the sighting range and a small enough magazine, each with the
 * parts they hang from, then let the optimiser fill the rest with several score mixes and keep
 * the cheapest build that passes every check the data can make.
 */
export async function solveGunsmith(
  objective: WeaponBuildObjective,
  presetRoot: BuildNode | null,
  context: GunsmithContext,
  signal?: AbortSignal
): Promise<GunsmithSolution> {
  const has = (name: string) => objective.requirements.some((rule) => rule.name === name);
  const priorities: Priorities = { weight: has("weight"), recoil: has("recoil"), ergonomics: has("ergonomics") };
  const locked = new Set<string>([objective.weaponId]);
  const base = presetRoot ?? { itemId: objective.weaponId, slots: {} };
  const placed = placeRequiredParts(base, context, objective.containsAll, locked, priorities);
  let root = placed.root;
  const start = root;
  for (const category of objective.containsCategory) {
    let found = false;
    walkNodes(root, (node) => {
      if (node.itemId !== root.itemId && context.inCategory(node.itemId, category)) {
        found = true;
        locked.add(node.itemId);
      }
    });
    if (found) continue;
    const targets = buyable(context, (item) => context.inCategory(item.id, category));
    root = placeOneOf(root, context, targets, locked, priorities) ?? root;
  }
  const range = objective.requirements.find((rule) => rule.name === "effectiveDistance" && rule.compareMethod === ">=");
  if (range && (sightingRange(root, context.lookup) ?? 0) < range.value) {
    const targets = buyable(context, (item) => (item.sightingRange ?? 0) >= range.value);
    root = placeOneOf(root, context, targets, locked, priorities) ?? root;
  }
  const magazineMax = objective.requirements.find((rule) => rule.name === "magazineCapacity" && rule.compareMethod === "<=");
  if (magazineMax) root = pickSmallMagazine(root, context, magazineMax.value, locked);
  const magazineMin = objective.requirements.find((rule) => rule.name === "magazineCapacity" && rule.compareMethod === ">=");

  const frame = skeleton(root, locked);
  let best = null as { root: BuildNode; goal: OptimizeGoal; cost: number; check: ReturnType<typeof checkRequirements> } | null;
  let closest = null as ReturnType<typeof checkRequirements> | null;
  for (const attempt of ATTEMPTS) {
    const result = await optimizeBuild(
      frame,
      context.lookup,
      {
        goal: attempt.goal,
        blend: attempt.blend,
        priceSources: context.sources,
        preset: context.preset,
        replaceExisting: false,
        allowUnpriced: false,
        ammoId: null,
        keepSights: false,
        minMagazineCapacity: magazineMin ? magazineMin.value : magazineMax ? null : undefined,
      },
      { signal }
    );
    const check = checkRequirements(result.root, objective, context);
    if (!closest || missScore(check) < missScore(closest)) closest = check;
    if (check.passes && (!best || result.costRUB < best.cost)) best = { root: result.root, goal: attempt.goal, cost: result.costRUB, check };
  }
  return {
    start,
    build: best?.root ?? null,
    goal: best?.goal ?? null,
    check: best?.check ?? closest ?? checkRequirements(start, objective, context),
    unplaced: placed.unplaced,
  };
}
