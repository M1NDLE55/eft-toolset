import type { BuildNode, GunItem, ModSlotDef, PriceSources } from "@/app/lib/types/gunBuilder";
import { MAX_BUILD_TREE_DEPTH, MAX_BUILD_TREE_NODES } from "./limits";
import { effectivePrice } from "./price";
import { isDetailed, type ItemLookup } from "./stats";
import { childAt, collectItemIds } from "./tree";
import { findConflicts, type BuildConflict } from "./conflicts";
import { slotKey, treesEqual } from "./compare";

export type OptimizeGoal = "ergonomics" | "recoil" | "cost";

export interface OptimizeTarget {
  parentPath: string[];
  slotId: string;
}

export interface OptimizeOptions {
  goal: OptimizeGoal;
  priceSources: PriceSources;
  budget?: number | null;
  replaceExisting?: boolean;
  allowUnpriced?: boolean;
  target?: OptimizeTarget | null;
  ammoId?: string | null;
}

export interface OptimizeControl {
  signal?: AbortSignal;
  pause?: () => Promise<void>;
  onProgress?: (step: number) => void;
}

export interface OptimizeResult {
  root: BuildNode;
  costRUB: number;
  withinBudget: boolean;
  changed: boolean;
  conflicts: number;
  evaluations: number;
}

const REQUIRED_PENALTY = 1e7;
const KEEP_PENALTY = 1e5;
const CONFLICT_PENALTY = 1e6;
const AMMO_PENALTY = 1e4;
const BEAM_WIDTH = 3;
const MAX_REPAIR_ROUNDS = 12;
const BUDGET_STEPS = 18;
const MAX_LAMBDA = 1e5;

interface Solved {
  node: BuildNode;
  value: number;
  cost: number;
}

interface Restrictions {
  items: ReadonlySet<string>;
  slots: ReadonlySet<string>;
}

interface Pass {
  lookup: ItemLookup;
  options: Required<Omit<OptimizeOptions, "target" | "budget" | "ammoId">> & {
    target: OptimizeTarget | null;
    ammoId: string | null;
  };
  lambda: number;
  restrictions: Restrictions;
  memo: Map<BuildNode | null, Map<string, Solved | null>>;
  stack: Set<string>;
  fixed: Set<BuildNode>;
}

interface Evaluation {
  solved: Solved;
  fixed: Set<BuildNode>;
  conflicts: BuildConflict[];
  restrictions: Restrictions;
  rank: number;
}

function timeSlicedPause(sliceMs = 12) {
  let last = Date.now();
  return async () => {
    if (Date.now() - last < sliceMs) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    last = Date.now();
  };
}

function itemScore(item: GunItem, price: number | null, goal: OptimizeGoal) {
  const ergo = item.ergonomics;
  const recoil = -item.recoilModifier * 100;
  const cost = (price ?? 0) / 1000;
  if (goal === "ergonomics") return ergo + recoil * 1e-3 - cost * 1e-6;
  if (goal === "recoil") return recoil + ergo * 1e-3 - cost * 1e-6;
  return -cost + (ergo + recoil) * 1e-6;
}

function samePath(a: string[], b: string[]) {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

function counterparts(defs: ModSlotDef[], old: BuildNode | undefined, sameItem: boolean, lookup: ItemLookup) {
  const result = new Map<string, BuildNode>();
  if (!old) return result;
  if (sameItem) {
    for (const def of defs) {
      const child = childAt(old, def.id);
      if (child) result.set(def.id, child);
    }
    return result;
  }
  const previous = lookup.get(old.itemId);
  const previousDefs = isDetailed(previous) ? previous.slots : [];
  const buckets = new Map<string, BuildNode[]>();
  for (const def of previousDefs) {
    const child = childAt(old, def.id);
    if (!child) continue;
    const key = slotKey(def.nameId);
    buckets.set(key, [...(buckets.get(key) ?? []), child]);
  }
  for (const def of defs) {
    const bucket = buckets.get(slotKey(def.nameId));
    const child = bucket?.shift();
    if (child) result.set(def.id, child);
  }
  return result;
}

function ammoFitsItem(item: GunItem, ammoId: string | null) {
  if (!ammoId || !isDetailed(item) || item.isWeapon) return true;
  const allowed = item.allowedAmmoIds ?? [];
  return allowed.length === 0 || allowed.includes(ammoId);
}

function emptyPenalty(slot: ModSlotDef, occupied: boolean) {
  return slot.required ? REQUIRED_PENALTY : occupied ? KEEP_PENALTY : 0;
}

function chooseForSlot(slot: ModSlotDef, old: BuildNode | undefined, pass: Pass): Solved | null {
  const emptyValue = -emptyPenalty(slot, Boolean(old));
  if (pass.restrictions.slots.has(slot.id)) return { node: { itemId: "", slots: {} }, value: emptyValue, cost: 0 };
  let best: Solved | null = null;
  const tried = new Set<string>();
  for (const id of slot.allowedItemIds) {
    if (tried.has(id) || pass.restrictions.items.has(id)) continue;
    tried.add(id);
    const solved = solveFree(id, old, pass);
    if (solved && (!best || solved.value > best.value)) best = solved;
  }
  if (!best || best.value <= emptyValue) return { node: { itemId: "", slots: {} }, value: emptyValue, cost: 0 };
  return best;
}

function solveFree(itemId: string, old: BuildNode | undefined, pass: Pass): Solved | null {
  const context = old ?? null;
  let cache = pass.memo.get(context);
  if (!cache) {
    cache = new Map();
    pass.memo.set(context, cache);
  }
  if (cache.has(itemId)) return cache.get(itemId)!;
  if (pass.stack.has(itemId) || pass.stack.size >= MAX_BUILD_TREE_DEPTH) return null;
  const item = pass.lookup.get(itemId);
  if (!item) {
    cache.set(itemId, null);
    return null;
  }
  const { goal, priceSources, allowUnpriced } = pass.options;
  const price = effectivePrice(item, priceSources);
  const current = old?.itemId === itemId;
  if (price === null && !current && !(allowUnpriced && goal !== "cost")) {
    cache.set(itemId, null);
    return null;
  }
  pass.stack.add(itemId);
  let value = itemScore(item, price, goal) - (pass.lambda * (price ?? 0)) / 1000;
  if (!ammoFitsItem(item, pass.options.ammoId)) value -= AMMO_PENALTY;
  let cost = price ?? 0;
  const slots: Record<string, BuildNode> = {};
  const defs = isDetailed(item) ? item.slots : [];
  const matched = counterparts(defs, old, current, pass.lookup);
  for (const slot of defs) {
    const choice = chooseForSlot(slot, matched.get(slot.id), pass);
    if (!choice) continue;
    value += choice.value;
    cost += choice.cost;
    if (choice.node.itemId) slots[slot.id] = choice.node;
  }
  pass.stack.delete(itemId);
  const solved = { node: { itemId, slots }, value, cost };
  cache.set(itemId, solved);
  return solved;
}

function slotMode(path: string[], occupied: boolean, pass: Pass): "keep" | "optimize" | "skip" {
  const target = pass.options.target;
  if (target) {
    if (samePath(path, [...target.parentPath, target.slotId])) return "optimize";
    return occupied ? "keep" : "skip";
  }
  if (!occupied) return "optimize";
  return pass.options.replaceExisting ? "optimize" : "keep";
}

function solveFixed(node: BuildNode, path: string[], pass: Pass): Solved {
  const item = pass.lookup.get(node.itemId);
  const price = item ? effectivePrice(item, pass.options.priceSources) : null;
  let value =
    (path.length > 0 && item ? itemScore(item, price, pass.options.goal) : 0) -
    (pass.lambda * (price ?? 0)) / 1000;
  let cost = price ?? 0;
  const slots: Record<string, BuildNode> = {};
  const defs = isDetailed(item) ? item.slots : [];
  const defined = new Set(defs.map((slot) => slot.id));
  for (const [slotId, child] of Object.entries(node.slots)) {
    if (defined.has(slotId)) continue;
    const kept = solveFixed(child, [...path, slotId], pass);
    value += kept.value;
    cost += kept.cost;
    slots[slotId] = kept.node;
  }
  for (const slot of defs) {
    const old = childAt(node, slot.id);
    const childPath = [...path, slot.id];
    const mode = slotMode(childPath, Boolean(old), pass);
    if (mode === "skip") continue;
    const choice = mode === "keep" && old ? solveFixed(old, childPath, pass) : chooseForSlot(slot, old, pass);
    if (!choice) continue;
    value += choice.value;
    cost += choice.cost;
    if (choice.node.itemId) slots[slot.id] = choice.node;
  }
  const result = { itemId: node.itemId, slots };
  pass.fixed.add(result);
  return { node: result, value, cost };
}

function repairOptions(conflict: BuildConflict, fixed: Set<BuildNode>): { items?: string; slots?: string }[] {
  const options: { items?: string; slots?: string }[] = [];
  const sourceFree = !fixed.has(conflict.source.node);
  const otherFree = !fixed.has(conflict.other.node);
  if (sourceFree) options.push({ items: conflict.source.node.itemId });
  if (conflict.kind === "item" && otherFree) options.push({ items: conflict.other.node.itemId });
  if (conflict.kind === "slot" && otherFree && conflict.slotId) options.push({ slots: conflict.slotId });
  return options;
}

function signature(restrictions: Restrictions) {
  return `${[...restrictions.items].sort().join(",")}|${[...restrictions.slots].sort().join(",")}`;
}

export async function optimizeBuild(
  root: BuildNode,
  lookup: ItemLookup,
  options: OptimizeOptions,
  control: OptimizeControl = {}
): Promise<OptimizeResult> {
  const weapon = lookup.get(root.itemId);
  if (!isDetailed(weapon)) throw new Error("Weapon details are not loaded yet.");
  const settings: Pass["options"] = {
    goal: options.goal,
    priceSources: options.priceSources,
    replaceExisting: options.replaceExisting ?? true,
    allowUnpriced: options.allowUnpriced ?? false,
    target: options.target ?? null,
    ammoId: options.ammoId ?? null,
  };
  const budget =
    typeof options.budget === "number" && Number.isFinite(options.budget) && options.budget >= 0
      ? options.budget
      : null;
  const pause = control.pause ?? timeSlicedPause();
  let evaluations = 0;

  async function evaluate(lambda: number, restrictions: Restrictions): Promise<Evaluation> {
    control.signal?.throwIfAborted();
    const pass: Pass = {
      lookup,
      options: settings,
      lambda,
      restrictions,
      memo: new Map(),
      stack: new Set(),
      fixed: new Set(),
    };
    const solved = solveFixed(root, [], pass);
    const conflicts = findConflicts(solved.node, lookup).filter(
      (conflict) => !pass.fixed.has(conflict.source.node) || !pass.fixed.has(conflict.other.node)
    );
    evaluations += 1;
    control.onProgress?.(evaluations);
    await pause();
    return {
      solved,
      fixed: pass.fixed,
      conflicts,
      restrictions,
      rank: solved.value - conflicts.length * CONFLICT_PENALTY,
    };
  }

  async function solveAt(lambda: number): Promise<Evaluation> {
    const start = await evaluate(lambda, { items: new Set(), slots: new Set() });
    let best = start;
    let beam = [start];
    const seen = new Set([signature(start.restrictions)]);
    for (let round = 0; round < MAX_REPAIR_ROUNDS; round += 1) {
      const next: Evaluation[] = [];
      for (const state of beam) {
        const conflict = state.conflicts.find((entry) => repairOptions(entry, state.fixed).length > 0);
        if (!conflict) continue;
        for (const option of repairOptions(conflict, state.fixed)) {
          const restrictions: Restrictions = {
            items: option.items ? new Set([...state.restrictions.items, option.items]) : state.restrictions.items,
            slots: option.slots ? new Set([...state.restrictions.slots, option.slots]) : state.restrictions.slots,
          };
          const key = signature(restrictions);
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(await evaluate(lambda, restrictions));
        }
      }
      if (next.length === 0) break;
      next.sort((a, b) => b.rank - a.rank);
      beam = next.slice(0, BEAM_WIDTH);
      if (beam[0].rank > best.rank) best = beam[0];
      if (best.conflicts.length === 0 && beam.every((state) => state.rank <= best.rank)) break;
    }
    return best;
  }

  const objective = (evaluation: Evaluation, lambda: number) =>
    evaluation.solved.value + (lambda * evaluation.solved.cost) / 1000 - evaluation.conflicts.length * CONFLICT_PENALTY;

  let chosen = await solveAt(0);
  let withinBudget = budget === null || chosen.solved.cost <= budget;
  if (!withinBudget && budget !== null) {
    let low = 0;
    let high = 1e-3;
    let feasible: { evaluation: Evaluation; lambda: number } | null = null;
    let cheapest = chosen;
    while (high <= MAX_LAMBDA) {
      const attempt = await solveAt(high);
      if (attempt.solved.cost < cheapest.solved.cost) cheapest = attempt;
      if (attempt.solved.cost <= budget) {
        feasible = { evaluation: attempt, lambda: high };
        break;
      }
      low = high;
      high *= 4;
    }
    if (feasible) {
      for (let step = 0; step < BUDGET_STEPS; step += 1) {
        const middle = (low + high) / 2;
        const attempt = await solveAt(middle);
        if (attempt.solved.cost <= budget) {
          high = middle;
          if (objective(attempt, middle) > objective(feasible.evaluation, feasible.lambda)) {
            feasible = { evaluation: attempt, lambda: middle };
          }
        } else {
          low = middle;
        }
      }
      chosen = feasible.evaluation;
      withinBudget = true;
    } else {
      chosen = cheapest;
    }
  }

  const result = chosen.solved.node;
  if (collectItemIds(result).length > MAX_BUILD_TREE_NODES) {
    throw new Error("The optimised build is larger than the supported size.");
  }
  return {
    root: result,
    costRUB: chosen.solved.cost,
    withinBudget,
    changed: !treesEqual(root, result),
    conflicts: chosen.conflicts.length,
    evaluations,
  };
}
