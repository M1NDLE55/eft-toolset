"use client";

import type { RaidPlan } from "./types";

const STORAGE_KEY = "raid-plans";

function now() {
  return Date.now();
}

function ensurePlans(): RaidPlan[] {
  if (typeof window === "undefined") return [];
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    window.localStorage.setItem(STORAGE_KEY, "[]");
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as RaidPlan[]) : [];
  } catch {
    return [];
  }
}

function writePlans(plans: RaidPlan[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

export function listPlans(): RaidPlan[] {
  return ensurePlans().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getPlan(id: string): RaidPlan | undefined {
  return ensurePlans().find((plan) => plan.id === id);
}

export function createPlan(name: string, mapKey: string): RaidPlan {
  const timestamp = now();
  const plan: RaidPlan = {
    id: crypto.randomUUID(),
    name,
    mapKey,
    createdAt: timestamp,
    updatedAt: timestamp,
    enabledLayers: [],
    route: [],
    drawings: [],
    notes: [],
  };

  writePlans([...ensurePlans(), plan]);
  return plan;
}

export function importPlan(
  plan: Omit<RaidPlan, "id" | "createdAt" | "updatedAt">
): RaidPlan {
  const timestamp = now();
  const imported: RaidPlan = {
    ...plan,
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writePlans([...ensurePlans(), imported]);
  return imported;
}

export function savePlan(plan: RaidPlan): RaidPlan {
  const updated: RaidPlan = { ...plan, updatedAt: now() };
  const plans = ensurePlans().map((candidate) =>
    candidate.id === plan.id ? updated : candidate
  );
  writePlans(plans);
  return updated;
}

export function renamePlan(id: string, name: string): RaidPlan | undefined {
  const plan = getPlan(id);
  if (!plan) return undefined;
  return savePlan({ ...plan, name });
}

export function duplicatePlan(id: string): RaidPlan | undefined {
  const plan = getPlan(id);
  if (!plan) return undefined;

  const timestamp = now();
  const duplicate: RaidPlan = {
    ...(JSON.parse(JSON.stringify(plan)) as RaidPlan),
    id: crypto.randomUUID(),
    name: `${plan.name} copy`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writePlans([...ensurePlans(), duplicate]);
  return duplicate;
}

export function deletePlan(id: string) {
  writePlans(ensurePlans().filter((plan) => plan.id !== id));
}
