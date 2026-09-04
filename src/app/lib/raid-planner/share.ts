import { getPlanDisplayColor, PLAN_COLORS, type Drawing, type GamePoint, type NotePin, type RaidPlan, type Waypoint } from "./types";
import {
  decodeSharePayload,
  encodeSharePayload,
  slugifyName,
} from "@/app/lib/share-codec";
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
  MAX_PLAN_NAME_LENGTH,
  MAX_POINTS_PER_DRAWING,
  MAX_ROUTE_POINTS,
  MAX_TOTAL_DRAWING_POINTS,
} from "./limits";

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
  assertPlanWithinLimits(plan);
  const recipe: SharedRaidPlanRecipeV1 = { v: 1, n: plan.name, m: plan.mapKey };

  if (plan.route.length > 0) {
    recipe.r = plan.route.map((waypoint) => encodePoint(waypoint.position));
  }
  if (plan.drawings.length > 0) {
    recipe.d = plan.drawings.map((drawing) => [
      drawing.kind,
      getPlanDisplayColor(drawing.color),
      drawing.points.map(encodePoint),
    ]);
  }
  if (plan.notes.length > 0) {
    recipe.t = plan.notes.map((note) => [
      round(note.position.x),
      round(note.position.z),
      note.title,
      note.body,
      getPlanDisplayColor(note.color),
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
      id: createId(),
      position: decodePoint(point),
    })),
    drawings: (recipe.d ?? []).map(([kind, color, points]) => ({
      id: createId(),
      kind,
      color,
      points: points.map(decodePoint),
    })),
    notes: (recipe.t ?? []).map(([x, z, title, body, color]) => ({
      id: createId(),
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
    value.every(
      (entry) =>
        typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) <= MAX_COORDINATE
    )
  );
}

function parseRecipe(value: unknown): SharedRaidPlanRecipeV1 {
  if (!value || typeof value !== "object") {
    throw new Error("Shared plan is not a valid recipe.");
  }

  const recipe = value as Partial<SharedRaidPlanRecipeV1>;
  if (
    recipe.v !== 1 ||
    typeof recipe.m !== "string" ||
    !recipe.m ||
    recipe.m.length > MAX_MAP_KEY_LENGTH ||
    (recipe.n !== undefined &&
      (typeof recipe.n !== "string" || recipe.n.length > MAX_PLAN_NAME_LENGTH))
  ) {
    throw new Error("Shared plan uses an unsupported recipe version.");
  }

  if (
    recipe.r !== undefined &&
    !(
      Array.isArray(recipe.r) &&
      recipe.r.length <= MAX_ROUTE_POINTS &&
      recipe.r.every(isPoint)
    )
  ) {
    throw new Error("Shared plan route is invalid.");
  }

  const validDrawing = (entry: unknown): entry is SharedDrawingV1 =>
    Array.isArray(entry) &&
    (entry[0] === "pen" || entry[0] === "arrow") &&
    typeof entry[1] === "string" &&
    PLAN_COLORS.some((color) => color === entry[1]) &&
    Array.isArray(entry[2]) &&
    entry[2].length >= 2 &&
    entry[2].length <= MAX_POINTS_PER_DRAWING &&
    entry[2].every(isPoint);
  if (
    recipe.d !== undefined &&
    !(
      Array.isArray(recipe.d) &&
      recipe.d.length <= MAX_DRAWINGS &&
      recipe.d.every(validDrawing) &&
      recipe.d.reduce((total, drawing) => total + drawing[2].length, 0) <=
        MAX_TOTAL_DRAWING_POINTS
    )
  ) {
    throw new Error("Shared plan drawings are invalid.");
  }

  const validNote = (entry: unknown): entry is SharedNoteV1 =>
    Array.isArray(entry) &&
    entry.length === 5 &&
    typeof entry[0] === "number" &&
    Number.isFinite(entry[0]) &&
    Math.abs(entry[0]) <= MAX_COORDINATE &&
    typeof entry[1] === "number" &&
    Number.isFinite(entry[1]) &&
    Math.abs(entry[1]) <= MAX_COORDINATE &&
    typeof entry[2] === "string" &&
    entry[2].length <= MAX_NOTE_TITLE_LENGTH &&
    typeof entry[3] === "string" &&
    entry[3].length <= MAX_NOTE_BODY_LENGTH &&
    typeof entry[4] === "string" &&
    PLAN_COLORS.some((color) => color === entry[4]);
  if (
    recipe.t !== undefined &&
    !(Array.isArray(recipe.t) && recipe.t.length <= MAX_NOTES && recipe.t.every(validNote))
  ) {
    throw new Error("Shared plan notes are invalid.");
  }

  if (
    recipe.l !== undefined &&
    !(
      Array.isArray(recipe.l) &&
      recipe.l.length <= MAX_LAYERS &&
      recipe.l.every(
        (layer) => typeof layer === "string" && layer.length <= MAX_LAYER_ID_LENGTH
      )
    )
  ) {
    throw new Error("Shared plan layers are invalid.");
  }

  return recipe as SharedRaidPlanRecipeV1;
}

function assertPlanWithinLimits(plan: RaidPlan) {
  const totalPoints = plan.drawings.reduce(
    (total, drawing) => total + drawing.points.length,
    0
  );
  if (
    plan.name.length > MAX_PLAN_NAME_LENGTH ||
    !plan.mapKey ||
    plan.mapKey.length > MAX_MAP_KEY_LENGTH ||
    plan.route.length > MAX_ROUTE_POINTS ||
    plan.route.some((waypoint) => !isSharePoint(waypoint.position)) ||
    plan.drawings.length > MAX_DRAWINGS ||
    plan.drawings.some(
      (drawing) =>
        (drawing.kind !== "pen" && drawing.kind !== "arrow") ||
        typeof drawing.color !== "string" ||
        drawing.points.length < 2 ||
        drawing.points.length > MAX_POINTS_PER_DRAWING ||
        drawing.points.some((point) => !isSharePoint(point))
    ) ||
    totalPoints > MAX_TOTAL_DRAWING_POINTS ||
    plan.notes.length > MAX_NOTES ||
    plan.notes.some(
      (note) =>
        note.title.length > MAX_NOTE_TITLE_LENGTH ||
        note.body.length > MAX_NOTE_BODY_LENGTH ||
        typeof note.color !== "string" ||
        !isSharePoint(note.position)
    ) ||
    plan.enabledLayers.length > MAX_LAYERS ||
    plan.enabledLayers.some(
      (layer) => !layer || layer.length > MAX_LAYER_ID_LENGTH
    )
  ) {
    throw new Error("This plan exceeds the safe sharing limits.");
  }
}

function isSharePoint(point: GamePoint) {
  return (
    Number.isFinite(point.x) &&
    Math.abs(point.x) <= MAX_COORDINATE &&
    Number.isFinite(point.z) &&
    Math.abs(point.z) <= MAX_COORDINATE
  );
}
