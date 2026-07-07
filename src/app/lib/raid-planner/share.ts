import type { Drawing, GamePoint, NotePin, RaidPlan, Waypoint } from "./types";
import {
  decodeSharePayload,
  encodeSharePayload,
  slugifyName,
} from "@/app/lib/share-codec";

type SharedPoint = [number, number];
type SharedDrawingV1 = ["pen" | "arrow", string, SharedPoint[]];
type SharedNoteV1 = [number, number, string, string, string];

export interface SharedRaidPlanRecipeV1 {
  v: 1;
  n?: string;
  m: string;
  r?: SharedPoint[];
  d?: SharedDrawingV1[];
  t?: SharedNoteV1[];
  l?: string[];
}

export interface DecodedSharedPlan {
  name: string;
  mapKey: string;
  enabledLayers: string[];
  route: Waypoint[];
  drawings: Drawing[];
  notes: NotePin[];
}

export function slugifyPlanName(name: string) {
  return slugifyName(name, "shared-plan");
}

/** 0.1 m is plenty for map geometry and keeps payloads short. */
function round(value: number) {
  return Math.round(value * 10) / 10;
}

function encodePoint(point: GamePoint): SharedPoint {
  return [round(point.x), round(point.z)];
}

function decodePoint(point: SharedPoint): GamePoint {
  return { x: point[0], z: point[1] };
}

export function createPlanShareRecipe(plan: RaidPlan): SharedRaidPlanRecipeV1 {
  const recipe: SharedRaidPlanRecipeV1 = { v: 1, n: plan.name, m: plan.mapKey };

  if (plan.route.length > 0) {
    recipe.r = plan.route.map((waypoint) => encodePoint(waypoint.position));
  }
  if (plan.drawings.length > 0) {
    recipe.d = plan.drawings.map((drawing) => [
      drawing.kind,
      drawing.color,
      drawing.points.map(encodePoint),
    ]);
  }
  if (plan.notes.length > 0) {
    recipe.t = plan.notes.map((note) => [
      round(note.position.x),
      round(note.position.z),
      note.title,
      note.body,
      note.color,
    ]);
  }
  if (plan.enabledLayers.length > 0) {
    recipe.l = plan.enabledLayers;
  }

  return recipe;
}

export function encodePlanSharePayload(plan: RaidPlan) {
  return encodeSharePayload(createPlanShareRecipe(plan));
}

export async function decodePlanSharePayload(
  payload: string
): Promise<DecodedSharedPlan> {
  const parsed = await decodeSharePayload(payload);
  const recipe = parseRecipe(parsed);

  return {
    name: recipe.n?.trim() || "Shared plan",
    mapKey: recipe.m,
    enabledLayers: (recipe.l ?? []).filter((id) => typeof id === "string"),
    route: (recipe.r ?? []).map((point) => ({
      id: crypto.randomUUID(),
      position: decodePoint(point),
    })),
    drawings: (recipe.d ?? []).map(([kind, color, points]) => ({
      id: crypto.randomUUID(),
      kind,
      color,
      points: points.map(decodePoint),
    })),
    notes: (recipe.t ?? []).map(([x, z, title, body, color]) => ({
      id: crypto.randomUUID(),
      position: { x, z },
      title,
      body,
      color,
    })),
  };
}

function isPoint(value: unknown): value is SharedPoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function parseRecipe(value: unknown): SharedRaidPlanRecipeV1 {
  if (!value || typeof value !== "object") {
    throw new Error("Shared plan is not a valid recipe.");
  }

  const recipe = value as Partial<SharedRaidPlanRecipeV1>;
  if (recipe.v !== 1 || typeof recipe.m !== "string" || !recipe.m) {
    throw new Error("Shared plan uses an unsupported recipe version.");
  }

  if (recipe.r !== undefined && !(Array.isArray(recipe.r) && recipe.r.every(isPoint))) {
    throw new Error("Shared plan route is invalid.");
  }

  const validDrawing = (entry: unknown): entry is SharedDrawingV1 =>
    Array.isArray(entry) &&
    (entry[0] === "pen" || entry[0] === "arrow") &&
    typeof entry[1] === "string" &&
    Array.isArray(entry[2]) &&
    entry[2].length >= 2 &&
    entry[2].every(isPoint);
  if (recipe.d !== undefined && !(Array.isArray(recipe.d) && recipe.d.every(validDrawing))) {
    throw new Error("Shared plan drawings are invalid.");
  }

  const validNote = (entry: unknown): entry is SharedNoteV1 =>
    Array.isArray(entry) &&
    entry.length === 5 &&
    typeof entry[0] === "number" &&
    typeof entry[1] === "number" &&
    typeof entry[2] === "string" &&
    typeof entry[3] === "string" &&
    typeof entry[4] === "string";
  if (recipe.t !== undefined && !(Array.isArray(recipe.t) && recipe.t.every(validNote))) {
    throw new Error("Shared plan notes are invalid.");
  }

  return recipe as SharedRaidPlanRecipeV1;
}
