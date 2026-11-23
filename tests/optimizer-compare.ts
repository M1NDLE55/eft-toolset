// Shared by the optimiser benchmark (tests/optimizer-benchmark.test.ts) and its regression test
// (tests/optimizer-regression.test.ts): the setups each weapon is optimised with, and how two
// results for the same inputs are compared.
import type { OptimizeGoal, OptimizeOptions, OptimizeResult } from "@/app/lib/builds/optimizer";
import type { PurchaseContext } from "@/app/lib/builds/purchase";
import type { PriceSources } from "@/app/lib/types/gunBuilder";

export type CaseName = "ergonomics" | "recoil" | "cost" | "heavy";

interface CaseSettings {
  goal: OptimizeGoal;
  budgetRUB?: number;
  allowUnpriced?: boolean;
  keepSights?: boolean;
  minMagazineCapacity?: number;
}

/**
 * The three goals with optimize_build's defaults, and the heaviest setup measured: a budget
 * (which makes the optimiser search over lambda), unpriced parts allowed, sights free to change,
 * and any magazine size.
 */
export const CASES: Record<CaseName, CaseSettings> = {
  ergonomics: { goal: "ergonomics" },
  recoil: { goal: "recoil" },
  cost: { goal: "cost" },
  heavy: { goal: "recoil", budgetRUB: 150_000, allowUnpriced: true, keepSights: false, minMagazineCapacity: 0 },
};

/** The options optimize_build passes for these settings, starting from the weapon's default preset. */
export function caseOptions(
  name: CaseName,
  priceSources: PriceSources,
  bought: PurchaseContext,
  ammoId: string | null
): OptimizeOptions {
  const settings = CASES[name];
  return {
    goal: settings.goal,
    priceSources,
    ...bought,
    budget: settings.budgetRUB ?? null,
    replaceExisting: true,
    allowUnpriced: settings.allowUnpriced ?? false,
    target: null,
    ammoId,
    keepSights: settings.keepSights ?? true,
    ...(settings.minMagazineCapacity === undefined ? {} : { minMagazineCapacity: settings.minMagazineCapacity || null }),
  };
}

/** What two runs are compared on. */
export interface Outcome {
  tree: string;
  costRUB: number;
  objective: number;
  conflicts: number;
  withinBudget: boolean;
}

export function outcomeOf(result: OptimizeResult): Outcome {
  return {
    tree: JSON.stringify(result.root),
    costRUB: result.costRUB,
    objective: result.objective,
    conflicts: result.conflicts,
    withinBudget: result.withinBudget,
  };
}

// Penalties and bonuses (emptied slots, conflicts, ammo, magazines, kept sights) are multiples
// of 10,000 points; the goal's own score is far smaller, so rounding recovers the penalty tier.
const PENALTY_STEP = 1e4;
export const MAX_GOAL_SCORE = PENALTY_STEP / 2;

export function penaltyTier(objective: number) {
  return Math.round(objective / PENALTY_STEP) * PENALTY_STEP;
}

export type Verdict = "equal" | "better" | "worse";

export interface Judgement {
  verdict: Verdict;
  reason: string;
}

/**
 * Equal: the same build, cost, score, conflicts and budget result. Better: fewer conflicts, or
 * within budget where it wasn't, or a higher score with no new penalty. Anything else is worse,
 * including a different build with the same score.
 */
export function judge(before: Outcome, after: Outcome): Judgement {
  const sameScore = Math.abs(after.objective - before.objective) < 1e-6;
  if (
    after.tree === before.tree &&
    after.costRUB === before.costRUB &&
    sameScore &&
    after.conflicts === before.conflicts &&
    after.withinBudget === before.withinBudget
  ) {
    return { verdict: "equal", reason: "same result" };
  }
  const budgetKept = after.withinBudget || !before.withinBudget;
  if (after.conflicts < before.conflicts && budgetKept) {
    return { verdict: "better", reason: `fewer conflicts (${before.conflicts} → ${after.conflicts})` };
  }
  if (after.withinBudget && !before.withinBudget && after.conflicts <= before.conflicts) {
    return { verdict: "better", reason: "within budget where it wasn't" };
  }
  if (
    after.conflicts === before.conflicts &&
    after.withinBudget === before.withinBudget &&
    penaltyTier(after.objective) >= penaltyTier(before.objective) &&
    after.objective > before.objective + 1e-6
  ) {
    return { verdict: "better", reason: `higher score, no new penalty (${signed(after.objective - before.objective)})` };
  }
  const details = [
    after.conflicts !== before.conflicts ? `conflicts ${before.conflicts} → ${after.conflicts}` : null,
    after.withinBudget !== before.withinBudget ? `within budget ${before.withinBudget} → ${after.withinBudget}` : null,
    sameScore ? "same score, different build" : `score ${signed(after.objective - before.objective)}`,
    penaltyTier(after.objective) < penaltyTier(before.objective) ? "new penalty" : null,
  ].filter(Boolean);
  return { verdict: "worse", reason: details.join(", ") };
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}
