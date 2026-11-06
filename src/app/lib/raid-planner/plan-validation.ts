import type { Drawing, GamePoint, NotePin, RaidPlan, Waypoint } from "./types";
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
import { isSafeTimestamp } from "@/app/lib/text-safety";

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_PLAN_ID_LENGTH;
}

const isTimestamp = isSafeTimestamp;

export function isPlanPoint(value: unknown): value is GamePoint {
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

export function isPlanColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isWaypoint(value: unknown): value is Waypoint {
  const waypoint = value as Partial<Waypoint> | null;
  return Boolean(waypoint) && typeof waypoint === "object" && isId(waypoint!.id) && isPlanPoint(waypoint!.position);
}

function isDrawing(value: unknown): value is Drawing {
  const drawing = value as Partial<Drawing> | null;
  return (
    Boolean(drawing) &&
    typeof drawing === "object" &&
    isId(drawing!.id) &&
    (drawing!.kind === "pen" || drawing!.kind === "arrow") &&
    isPlanColor(drawing!.color) &&
    Array.isArray(drawing!.points) &&
    drawing!.points.length >= 2 &&
    drawing!.points.length <= MAX_POINTS_PER_DRAWING &&
    drawing!.points.every(isPlanPoint)
  );
}

function isNote(value: unknown): value is NotePin {
  const note = value as Partial<NotePin> | null;
  return (
    Boolean(note) &&
    typeof note === "object" &&
    isId(note!.id) &&
    isPlanPoint(note!.position) &&
    typeof note!.title === "string" &&
    note!.title.length <= MAX_NOTE_TITLE_LENGTH &&
    typeof note!.body === "string" &&
    note!.body.length <= MAX_NOTE_BODY_LENGTH &&
    isPlanColor(note!.color)
  );
}

export function describePlanProblem(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "is not a plan";
  const plan = value as Partial<RaidPlan>;
  if (!isId(plan.id)) return "has a missing or invalid id";
  if (typeof plan.name !== "string" || plan.name.length > MAX_PLAN_NAME_LENGTH) {
    return `needs a name of at most ${MAX_PLAN_NAME_LENGTH} characters`;
  }
  if (typeof plan.mapKey !== "string" || !plan.mapKey || plan.mapKey.length > MAX_MAP_KEY_LENGTH) {
    return "has a missing or invalid map";
  }
  if (!isTimestamp(plan.createdAt) || !isTimestamp(plan.updatedAt)) return "has invalid dates";
  if (
    !Array.isArray(plan.enabledLayers) ||
    plan.enabledLayers.length > MAX_LAYERS ||
    !plan.enabledLayers.every((layer) => typeof layer === "string" && layer.length <= MAX_LAYER_ID_LENGTH)
  ) {
    return "has invalid map layers";
  }
  if (!Array.isArray(plan.route) || plan.route.length > MAX_ROUTE_POINTS || !plan.route.every(isWaypoint)) {
    return "has an invalid route";
  }
  if (
    !Array.isArray(plan.drawings) ||
    plan.drawings.length > MAX_DRAWINGS ||
    !plan.drawings.every(isDrawing)
  ) {
    return "has invalid drawings";
  }
  if (plan.drawings.reduce((total, drawing) => total + drawing.points.length, 0) > MAX_TOTAL_DRAWING_POINTS) {
    return "has more drawing detail than a plan can hold";
  }
  if (!Array.isArray(plan.notes) || plan.notes.length > MAX_NOTES || !plan.notes.every(isNote)) {
    return "has invalid notes";
  }
  return null;
}

export function isPlan(value: unknown): value is RaidPlan {
  return describePlanProblem(value) === null;
}

export function isPlanList(value: unknown): value is RaidPlan[] {
  return Array.isArray(value) && value.length <= MAX_PLANS && value.every(isPlan);
}

function pickPoint(point: GamePoint): GamePoint {
  return point.y === undefined ? { x: point.x, z: point.z } : { x: point.x, z: point.z, y: point.y };
}

export function pickPlanFields(plan: RaidPlan): RaidPlan {
  return {
    id: plan.id,
    name: plan.name,
    mapKey: plan.mapKey,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    enabledLayers: [...plan.enabledLayers],
    route: plan.route.map((waypoint) => ({ id: waypoint.id, position: pickPoint(waypoint.position) })),
    drawings: plan.drawings.map((drawing) => ({
      id: drawing.id,
      kind: drawing.kind,
      color: drawing.color,
      points: drawing.points.map(pickPoint),
    })),
    notes: plan.notes.map((note) => ({
      id: note.id,
      position: pickPoint(note.position),
      title: note.title,
      body: note.body,
      color: note.color,
    })),
  };
}
