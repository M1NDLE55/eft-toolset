"use client";

import type { RaidPlan } from "./types";
import { useMemo } from "react";
import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";
import { createId } from "@/app/lib/id";
import { MAX_PLAN_NAME_LENGTH, MAX_PLANS } from "./limits";
import { isPlan, isPlanList } from "./plan-validation";

export const PLAN_STORE: StoreDefinition<RaidPlan[]> = {
  key: "eft-toolset:raid-plans",
  legacyKeys: ["raid-plans"],
  version: 1,
  defaultValue: () => [],
  validate: isPlanList,
  recover: (value) =>
    Array.isArray(value) ? value.filter(isPlan).slice(0, MAX_PLANS) : undefined,
};

function readPlans(): RaidPlan[] {
  return readStore(PLAN_STORE);
}

function appendPlan(plan: RaidPlan) {
  const plans = readPlans();
  if (plans.length >= MAX_PLANS) {
    throw new Error(`You can save at most ${MAX_PLANS} plans. Delete one to make room.`);
  }
  writeStore(PLAN_STORE, [...plans, plan]);
  return plan;
}

function normalizeName(name: string, fallback: string) {
  return (name.trim() || fallback).slice(0, MAX_PLAN_NAME_LENGTH);
}

export function usePlans(): RaidPlan[] {
  const plans = useStore(PLAN_STORE);
  return useMemo(() => [...plans].sort((a, b) => b.updatedAt - a.updatedAt), [plans]);
}

export function getPlan(id: string): RaidPlan | undefined {
  return readPlans().find((plan) => plan.id === id);
}

export function createPlan(name: string, mapKey: string): RaidPlan {
  const timestamp = Date.now();
  return appendPlan({
    id: createId(),
    name: normalizeName(name, "Untitled raid"),
    mapKey,
    createdAt: timestamp,
    updatedAt: timestamp,
    enabledLayers: [],
    route: [],
    drawings: [],
    notes: [],
  });
}

export function importPlan(
  plan: Omit<RaidPlan, "id" | "createdAt" | "updatedAt">
): RaidPlan {
  const timestamp = Date.now();
  return appendPlan({
    ...plan,
    name: normalizeName(plan.name, "Shared plan"),
    id: createId(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function importPlans(plans: RaidPlan[]): RaidPlan[] {
  const existing = readPlans();
  const room = MAX_PLANS - existing.length;
  if (plans.length > room) {
    throw new Error(
      room <= 0
        ? `You already have ${MAX_PLANS} plans. Delete some to make room.`
        : `This file has ${plans.length} plans, but there is only room for ${room} more. Delete some plans first.`
    );
  }
  const timestamp = Date.now();
  const imported = plans.map(
    (plan): RaidPlan => ({
      id: createId(),
      name: normalizeName(plan.name, "Imported plan"),
      mapKey: plan.mapKey,
      createdAt: Math.min(Math.max(0, plan.createdAt), timestamp),
      updatedAt: timestamp,
      enabledLayers: [...new Set(plan.enabledLayers)],
      route: plan.route.map((waypoint) => ({ ...waypoint, id: createId() })),
      drawings: plan.drawings.map((drawing) => ({ ...drawing, id: createId() })),
      notes: plan.notes.map((note) => ({ ...note, id: createId() })),
    })
  );
  writeStore(PLAN_STORE, [...existing, ...imported]);
  return imported;
}

export function savePlan(plan: RaidPlan): RaidPlan {
  const updated: RaidPlan = { ...plan, updatedAt: Date.now() };
  const plans = readPlans();
  const index = plans.findIndex((candidate) => candidate.id === plan.id);
  if (index === -1) throw new Error("This plan no longer exists in browser storage.");
  writeStore(PLAN_STORE, plans.with(index, updated));
  return updated;
}

export function duplicatePlan(id: string): RaidPlan | undefined {
  const plan = getPlan(id);
  if (!plan) return undefined;
  const timestamp = Date.now();
  return appendPlan({
    ...structuredClone(plan),
    id: createId(),
    name: `${plan.name.slice(0, MAX_PLAN_NAME_LENGTH - 5)} copy`,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function deletePlan(id: string) {
  writeStore(PLAN_STORE, readPlans().filter((plan) => plan.id !== id));
}
