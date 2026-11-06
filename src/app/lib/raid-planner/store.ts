"use client";

import type { GamePoint, RaidPlan } from "./types";
import { useMemo } from "react";
import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";
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
