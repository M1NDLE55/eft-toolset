"use client";

import type { GamePoint, RaidPlan } from "./types";
import { readStore, subscribeStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { createId } from "@/app/lib/id";
import {
  MAX_COORDINATE,
  MAX_DRAWINGS,
  MAX_LAYERS,
  MAX_LAYER_ID_LENGTH,
  MAX_MAP_KEY_LENGTH,
  MAX_NOTES,
  MAX_NOTE_BODY_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  MAX_PLAN_ID_LENGTH,
  MAX_PLAN_NAME_LENGTH,
  MAX_PLANS,
  MAX_POINTS_PER_DRAWING,
  MAX_ROUTE_POINTS,
  MAX_TOTAL_DRAWING_POINTS,
} from "./limits";

const PLAN_STORE: StoreDefinition<RaidPlan[]> = {
  key: "eft-toolset:raid-plans",
  legacyKeys: ["raid-plans"],
  version: 1,
  defaultValue: () => [],
  validate: isPlanList,
  recover: (value) =>
    Array.isArray(value) ? value.filter(isPlan).slice(0, MAX_PLANS) : undefined,
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
    id: createId(),
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
    id: createId(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writePlans([...ensurePlans(), imported]);
  return imported;
}

export function savePlan(plan: RaidPlan): RaidPlan {
  const updated: RaidPlan = { ...plan, updatedAt: now() };
  let found = false;
  const plans = ensurePlans().map((candidate) => {
    if (candidate.id !== plan.id) return candidate;
    found = true;
    return updated;
  });
  if (!found) throw new Error("This plan no longer exists in browser storage.");
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
    id: createId(),
    name: `${plan.name.slice(0, MAX_PLAN_NAME_LENGTH - 5)} copy`,
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
  return Array.isArray(value) && value.length <= MAX_PLANS && value.every(isPlan);
}

function isPlan(value: unknown): value is RaidPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<RaidPlan>;
  return (
    typeof plan.id === "string" &&
    plan.id.length > 0 &&
    plan.id.length <= MAX_PLAN_ID_LENGTH &&
    typeof plan.name === "string" &&
    plan.name.length <= MAX_PLAN_NAME_LENGTH &&
    typeof plan.mapKey === "string" &&
    plan.mapKey.length > 0 &&
    plan.mapKey.length <= MAX_MAP_KEY_LENGTH &&
    typeof plan.createdAt === "number" &&
    Number.isFinite(plan.createdAt) &&
    typeof plan.updatedAt === "number" &&
    Number.isFinite(plan.updatedAt) &&
    Array.isArray(plan.enabledLayers) &&
    plan.enabledLayers.length <= MAX_LAYERS &&
    plan.enabledLayers.every((layer) => typeof layer === "string" && layer.length <= MAX_LAYER_ID_LENGTH) &&
    Array.isArray(plan.route) &&
    plan.route.length <= MAX_ROUTE_POINTS &&
    plan.route.every(
      (waypoint) =>
        Boolean(waypoint) &&
        typeof waypoint.id === "string" &&
        waypoint.id.length > 0 &&
        waypoint.id.length <= MAX_PLAN_ID_LENGTH &&
        isPoint(waypoint.position)
    ) &&
    Array.isArray(plan.drawings) &&
    plan.drawings.length <= MAX_DRAWINGS &&
    plan.drawings.every(
      (drawing) =>
        Boolean(drawing) &&
        typeof drawing.id === "string" &&
        drawing.id.length > 0 &&
        drawing.id.length <= MAX_PLAN_ID_LENGTH &&
        (drawing.kind === "pen" || drawing.kind === "arrow") &&
        isColor(drawing.color) &&
        Array.isArray(drawing.points) &&
        drawing.points.length >= 2 &&
        drawing.points.length <= MAX_POINTS_PER_DRAWING &&
        drawing.points.every(isPoint)
    ) &&
    plan.drawings.reduce((total, drawing) => total + drawing.points.length, 0) <=
      MAX_TOTAL_DRAWING_POINTS &&
    Array.isArray(plan.notes) &&
    plan.notes.length <= MAX_NOTES &&
    plan.notes.every(
      (note) =>
        Boolean(note) &&
        typeof note.id === "string" &&
        note.id.length > 0 &&
        note.id.length <= MAX_PLAN_ID_LENGTH &&
        isPoint(note.position) &&
        typeof note.title === "string" &&
        note.title.length <= MAX_NOTE_TITLE_LENGTH &&
        typeof note.body === "string" &&
        note.body.length <= MAX_NOTE_BODY_LENGTH &&
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
    Math.abs(point.x) <= MAX_COORDINATE &&
    typeof point.z === "number" &&
    Number.isFinite(point.z) &&
    Math.abs(point.z) <= MAX_COORDINATE &&
    (point.y === undefined ||
      (typeof point.y === "number" && Number.isFinite(point.y) && Math.abs(point.y) <= MAX_COORDINATE))
  );
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
