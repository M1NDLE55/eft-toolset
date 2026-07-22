"use client";

import type { GamePoint, RaidPlan } from "./types";
import { readStore, subscribeStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";

const PLAN_STORE: StoreDefinition<RaidPlan[]> = {
  key: "eft-toolset:raid-plans",
  legacyKeys: ["raid-plans"],
  version: 1,
  defaultValue: () => [],
  validate: isPlanList,
};

function now() {
  return Date.now();
}

function ensurePlans(): RaidPlan[] {
  return readStore(PLAN_STORE);
}

function writePlans(plans: RaidPlan[]) {
  writeStore(PLAN_STORE, plans);
}

export function listPlans(): RaidPlan[] {
  return ensurePlans().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function subscribePlans(listener: () => void) {
  return subscribeStore(PLAN_STORE.key, listener);
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

function isPlanList(value: unknown): value is RaidPlan[] {
  return Array.isArray(value) && value.length <= 500 && value.every(isPlan);
}

function isPlan(value: unknown): value is RaidPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<RaidPlan>;
  return (
    typeof plan.id === "string" &&
    typeof plan.name === "string" &&
    plan.name.length <= 120 &&
    typeof plan.mapKey === "string" &&
    plan.mapKey.length <= 80 &&
    typeof plan.createdAt === "number" &&
    Number.isFinite(plan.createdAt) &&
    typeof plan.updatedAt === "number" &&
    Number.isFinite(plan.updatedAt) &&
    Array.isArray(plan.enabledLayers) &&
    plan.enabledLayers.length <= 200 &&
    plan.enabledLayers.every((layer) => typeof layer === "string" && layer.length <= 120) &&
    Array.isArray(plan.route) &&
    plan.route.length <= 500 &&
    plan.route.every(
      (waypoint) =>
        Boolean(waypoint) &&
        typeof waypoint.id === "string" &&
        isPoint(waypoint.position)
    ) &&
    Array.isArray(plan.drawings) &&
    plan.drawings.length <= 500 &&
    plan.drawings.every(
      (drawing) =>
        Boolean(drawing) &&
        typeof drawing.id === "string" &&
        (drawing.kind === "pen" || drawing.kind === "arrow") &&
        isColor(drawing.color) &&
        Array.isArray(drawing.points) &&
        drawing.points.length >= 2 &&
        drawing.points.length <= 5_000 &&
        drawing.points.every(isPoint)
    ) &&
    Array.isArray(plan.notes) &&
    plan.notes.length <= 500 &&
    plan.notes.every(
      (note) =>
        Boolean(note) &&
        typeof note.id === "string" &&
        isPoint(note.position) &&
        typeof note.title === "string" &&
        note.title.length <= 120 &&
        typeof note.body === "string" &&
        note.body.length <= 2_000 &&
        isColor(note.color)
    )
  );
}

function isPoint(value: unknown): value is GamePoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<GamePoint>;
  return (
    typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    Math.abs(point.x) <= 1_000_000 &&
    typeof point.z === "number" &&
    Number.isFinite(point.z) &&
    Math.abs(point.z) <= 1_000_000 &&
    (point.y === undefined ||
      (typeof point.y === "number" && Number.isFinite(point.y) && Math.abs(point.y) <= 1_000_000))
  );
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
