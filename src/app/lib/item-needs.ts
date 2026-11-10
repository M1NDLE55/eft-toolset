import type { CachedTask, CachedTaskObjective, ItemUses } from "@/app/lib/cache/types";

/** Objective types that take the item away: handed over, planted, sold, or used as a marker. */
const CONSUMING_OBJECTIVES = new Set(["giveItem", "plantItem", "sellItem", "mark"]);
const FACTIONS = ["USEC", "BEAR"] as const;

export interface TaskNeed {
  /** Items the task takes; 0 when it only uses the item or accepts other items too. */
  count: number;
  /** How many of those must be found in raid. */
  foundInRaid: number;
}

function specific(objective: CachedTaskObjective) {
  return !objective.optional && !objective.alternatives && typeof objective.count === "number" && objective.count > 0;
}

/**
 * How many of the item one task needs. Find-and-hand-over pairs count once: the hand-over
 * decides the number, and a find objective counts only when nothing is handed over.
 */
export function taskNeed(task: CachedTask): TaskNeed {
  const consumed = task.objectives.filter(
    (objective) => specific(objective) && CONSUMING_OBJECTIVES.has(objective.type ?? "")
  );
  if (consumed.length > 0) {
    return consumed.reduce<TaskNeed>(
      (need, objective) => ({
        count: need.count + (objective.count ?? 0),
        foundInRaid: need.foundInRaid + (objective.foundInRaid ? (objective.count ?? 0) : 0),
      }),
      { count: 0, foundInRaid: 0 }
    );
  }
  let need: TaskNeed = { count: 0, foundInRaid: 0 };
  for (const objective of task.objectives) {
    if (!specific(objective) || objective.type !== "findItem") continue;
    const count = objective.count ?? 0;
    if (count > need.count) need = { count, foundInRaid: objective.foundInRaid ? count : 0 };
  }
  return need;
}

export interface ItemNeeds {
  /** Items needed for tasks and hideout upgrades together. */
  total: number;
  foundInRaid: number;
  forTasks: number;
  taskCount: number;
  forHideout: number;
  upgradeCount: number;
  /** Hideout slots the item can be installed in (for example Bitcoin Farm graphics cards). */
  hideoutSlots: number;
  /** Tasks that use the item without taking it, or accept other items instead. */
  otherTaskCount: number;
  summary: string;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Totals across every task and hideout upgrade, whatever the player has already done.
 * Faction-only tasks count once, for the faction that needs more.
 */
export function summarizeNeeds(uses: ItemUses): ItemNeeds | null {
  const shared = { count: 0, foundInRaid: 0, tasks: 0 };
  const byFaction = new Map(FACTIONS.map((faction) => [faction, { count: 0, foundInRaid: 0, tasks: 0 }]));
  let otherTaskCount = 0;
  for (const task of uses.usedInTasks) {
    const need = taskNeed(task);
    if (need.count === 0) {
      otherTaskCount += 1;
      continue;
    }
    const bucket = byFaction.get(task.faction as (typeof FACTIONS)[number]) ?? shared;
    bucket.count += need.count;
    bucket.foundInRaid += need.foundInRaid;
    bucket.tasks += 1;
  }
  const faction = Array.from(byFaction.values()).reduce(
    (most, entry) => (entry.count > most.count ? entry : most),
    { count: 0, foundInRaid: 0, tasks: 0 }
  );
  const forTasks = shared.count + faction.count;
  const taskFir = shared.foundInRaid + faction.foundInRaid;
  const taskCount = shared.tasks + faction.tasks;
  const forHideout = uses.hideoutRequirements.reduce((total, entry) => total + entry.count, 0);
  const hideoutFir = uses.hideoutRequirements.reduce(
    (total, entry) => total + (entry.foundInRaid ? entry.count : 0),
    0
  );
  const hideoutSlots = uses.hideoutSlots.reduce((total, entry) => total + entry.slots, 0);
  if (forTasks === 0 && forHideout === 0 && hideoutSlots === 0 && otherTaskCount === 0) return null;

  const total = forTasks + forHideout;
  const foundInRaid = taskFir + hideoutFir;
  const fir = (count: number) => (count > 0 ? ` (${count} FIR)` : "");
  const parts: string[] = [];
  if (forTasks > 0) parts.push(`${forTasks} for ${plural(taskCount, "task")}${fir(taskFir)}`);
  if (forHideout > 0) {
    parts.push(`${forHideout} for ${plural(uses.hideoutRequirements.length, "hideout upgrade")}${fir(hideoutFir)}`);
  }
  const stations = Array.from(new Set(uses.hideoutSlots.map((entry) => entry.station.name)));
  if (hideoutSlots > 0) parts.push(`${stations.join(", ")} holds up to ${hideoutSlots} installed`);
  if (otherTaskCount > 0) {
    parts.push(`not counted: ${plural(otherTaskCount, "task")} using it or accepting other items`);
  }
  const head = total > 0 ? `${total} needed${fir(foundInRaid)}: ` : "";
  return {
    total,
    foundInRaid,
    forTasks,
    taskCount,
    forHideout,
    upgradeCount: uses.hideoutRequirements.length,
    hideoutSlots,
    otherTaskCount,
    summary: head + parts.join("; "),
  };
}
