import type { RaidPlan } from "./types";

export const HISTORY_LIMIT = 50;

export interface PlanHistory {
  past: RaidPlan[];
  future: RaidPlan[];
}

export interface HistoryStep {
  history: PlanHistory;
  plan: RaidPlan;
}

export const EMPTY_HISTORY: PlanHistory = { past: [], future: [] };

function push(stack: RaidPlan[], plan: RaidPlan) {
  return [...stack.slice(1 - HISTORY_LIMIT), plan];
}

function restore(snapshot: RaidPlan, current: RaidPlan): RaidPlan {
  return { ...snapshot, enabledLayers: current.enabledLayers };
}

export function recordChange(history: PlanHistory, previous: RaidPlan): PlanHistory {
  return { past: push(history.past, previous), future: [] };
}

export function undoStep(history: PlanHistory, current: RaidPlan): HistoryStep | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return {
    plan: restore(previous, current),
    history: { past: history.past.slice(0, -1), future: push(history.future, current) },
  };
}

export function redoStep(history: PlanHistory, current: RaidPlan): HistoryStep | null {
  const next = history.future.at(-1);
  if (!next) return null;
  return {
    plan: restore(next, current),
    history: { past: push(history.past, current), future: history.future.slice(0, -1) },
  };
}
