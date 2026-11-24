import type { GamePoint, RaidPlan } from "@/app/lib/raid-planner/types";
import { PLAN_LIMITS } from "@/app/lib/durable/limits";
import { compareOrder, isOrderKey, keyBetween, spreadKeys } from "./order-key";
import { roundCoordinate } from "./content-hash";
import type { PlanContent } from "./plan-content";

/**
 * A raid plan as live editing sees it (§6.2, §11): its content with each entity's revision (the plan
 * rev that last changed it), waypoints' order keys, and note title and body revisions for
 * compare-and-set. PlanDO applies ops to it on the server; the browser applies the same ops to its
 * cached copy, so both sides follow one set of rules.
 */
export interface WaypointRow {
  id: string;
  x: number;
  z: number;
  y?: number;
  ord: string;
  rev: number;
  by: string | null;
}

export interface DrawingRow {
  id: string;
  kind: "pen" | "arrow";
  color: string;
  points: GamePoint[];
  rev: number;
  by: string | null;
}

export interface NoteRow {
  id: string;
  x: number;
  z: number;
  y?: number;
  title: string;
  body: string;
  color: string;
  titleRev: number;
  bodyRev: number;
  rev: number;
  by: string | null;
}

export interface PlanDoc {
  name: string;
  mapKey: string;
  layers: string[];
  waypoints: Record<string, WaypointRow>;
  drawings: Record<string, DrawingRow>;
  notes: Record<string, NoteRow>;
}

export type PlanOp =
  | { t: "wp.add"; id: string; at: GamePoint; ord: string }
  | { t: "wp.move"; id: string; at: GamePoint }
  | { t: "wp.order"; id: string; ord: string }
  | { t: "wp.del"; id: string }
  | { t: "draw.add"; id: string; kind: "pen" | "arrow"; color: string; points: GamePoint[] }
  | { t: "draw.del"; id: string }
  | { t: "note.add"; id: string; at: GamePoint; title: string; body: string; color: string }
  | { t: "note.move"; id: string; at: GamePoint }
  | { t: "note.color"; id: string; color: string }
  | { t: "note.text"; id: string; field: "title" | "body"; value: string; base: number }
  | { t: "note.del"; id: string }
  | { t: "layer.on" | "layer.off"; layer: string }
  | { t: "plan.rename"; name: string };

export type OpErrorCode = "gone" | "conflict" | "limit" | "invalid";

/** Why a batch was refused; the whole batch rolls back. */
export class OpError extends Error {
  constructor(
    readonly code: OpErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "OpError";
  }
}

const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_COORDINATE = 1_000_000;

function point(value: unknown): GamePoint {
  const candidate = value as Partial<GamePoint> | null;
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_COORDINATE;
  if (!candidate || !ok(candidate.x) || !ok(candidate.z) || (candidate.y !== undefined && !ok(candidate.y))) throw new OpError("invalid", "A point needs x and z in game metres.");
  return candidate.y === undefined
    ? { x: roundCoordinate(candidate.x!), z: roundCoordinate(candidate.z!) }
    : { x: roundCoordinate(candidate.x!), z: roundCoordinate(candidate.z!), y: roundCoordinate(candidate.y) };
}

function id(value: unknown): string {
  if (typeof value !== "string" || !ENTITY_ID.test(value)) throw new OpError("invalid", "That id isn't valid.");
  return value;
}

function color(value: unknown): string {
  if (typeof value !== "string" || !COLOR.test(value)) throw new OpError("invalid", "Colours are #rrggbb.");
  return value.toLowerCase();
}

function text(value: unknown, max: number, what: string): string {
  if (typeof value !== "string" || value.length > max) throw new OpError("limit", `${what} can be at most ${max} characters.`, { limit: max });
  return value;
}

/** Checks an op's shape and normalises it (coordinates rounded, colours lower-case). */
export function normalizeOp(op: unknown): PlanOp {
  const value = op as { t?: unknown } & Record<string, unknown>;
  switch (value?.t) {
    case "wp.add":
      if (!isOrderKey(value.ord)) throw new OpError("invalid", "That order key isn't valid.");
      return { t: "wp.add", id: id(value.id), at: point(value.at), ord: value.ord };
    case "wp.move":
      return { t: "wp.move", id: id(value.id), at: point(value.at) };
    case "wp.order":
      if (!isOrderKey(value.ord)) throw new OpError("invalid", "That order key isn't valid.");
      return { t: "wp.order", id: id(value.id), ord: value.ord };
    case "wp.del":
    case "draw.del":
    case "note.del":
      return { t: value.t, id: id(value.id) };
    case "draw.add": {
      if (value.kind !== "pen" && value.kind !== "arrow") throw new OpError("invalid", "Drawings are pen or arrow.");
      if (!Array.isArray(value.points) || value.points.length < 2) throw new OpError("invalid", "A drawing needs at least two points.");
      if (value.points.length > PLAN_LIMITS.maxPointsPerDrawing) {
        throw new OpError("limit", `A drawing can have at most ${PLAN_LIMITS.maxPointsPerDrawing} points.`, { limit: PLAN_LIMITS.maxPointsPerDrawing, used: value.points.length });
      }
      return { t: "draw.add", id: id(value.id), kind: value.kind, color: color(value.color), points: value.points.map(point) };
    }
    case "note.add":
      return {
        t: "note.add",
        id: id(value.id),
        at: point(value.at),
        title: text(value.title, PLAN_LIMITS.maxNoteTitleLength, "Note titles"),
        body: text(value.body ?? "", PLAN_LIMITS.maxNoteBodyLength, "Notes"),
        color: color(value.color),
      };
    case "note.move":
      return { t: "note.move", id: id(value.id), at: point(value.at) };
    case "note.color":
      return { t: "note.color", id: id(value.id), color: color(value.color) };
    case "note.text": {
      if (value.field !== "title" && value.field !== "body") throw new OpError("invalid", "field is title or body.");
      if (!Number.isSafeInteger(value.base) || (value.base as number) < 0) throw new OpError("invalid", "base is the field's revision the edit started from.");
      const max = value.field === "title" ? PLAN_LIMITS.maxNoteTitleLength : PLAN_LIMITS.maxNoteBodyLength;
      return { t: "note.text", id: id(value.id), field: value.field, value: text(value.value, max, value.field === "title" ? "Note titles" : "Notes"), base: value.base as number };
    }
    case "layer.on":
    case "layer.off":
      if (typeof value.layer !== "string" || !value.layer || value.layer.length > 120) throw new OpError("invalid", "That layer id isn't valid.");
      return { t: value.t, layer: value.layer };
    case "plan.rename": {
      const name = typeof value.name === "string" ? value.name.trim() : "";
      if (!name) throw new OpError("invalid", "A plan needs a name.");
      return { t: "plan.rename", name: text(name, PLAN_LIMITS.maxNameLength, "Plan names") };
    }
    default:
      throw new OpError("invalid", "Unknown op.");
  }
}

/** The plan as the raid planner (and exports, copies and hashes) sees it. */
export function contentOf(doc: PlanDoc): PlanContent {
  const route = Object.values(doc.waypoints)
    .sort(compareOrder)
    .map((waypoint) => ({ id: waypoint.id, position: positionOf(waypoint) }));
  return {
    name: doc.name,
    mapKey: doc.mapKey,
    enabledLayers: [...doc.layers],
    route,
    drawings: Object.values(doc.drawings)
      .sort((a, b) => a.rev - b.rev || (a.id < b.id ? -1 : 1))
      .map((drawing) => ({ id: drawing.id, kind: drawing.kind, color: drawing.color, points: drawing.points })),
    notes: Object.values(doc.notes)
      .sort((a, b) => a.rev - b.rev || (a.id < b.id ? -1 : 1))
      .map((note) => ({ id: note.id, position: positionOf(note), title: note.title, body: note.body, color: note.color })),
  };
}

function positionOf(row: { x: number; z: number; y?: number }): GamePoint {
  return row.y === undefined ? { x: row.x, z: row.z } : { x: row.x, z: row.z, y: row.y };
}

export function toRaidPlan(doc: PlanDoc, planId: string, times: { createdAt: number; updatedAt: number }): RaidPlan {
  return { id: planId, ...times, ...contentOf(doc) };
}

/** The canonical size (§9.3): UTF-8 bytes of the content as JSON. */
export function planBytes(doc: PlanDoc) {
  return new TextEncoder().encode(JSON.stringify(contentOf(doc))).byteLength;
}

/** A new plan's document from content, checked against every cap. Entities keep their ids. */
export function docFromContent(content: PlanContent, by: string | null, rev = 0): PlanDoc {
  const doc: PlanDoc = { name: "", mapKey: "", layers: [], waypoints: {}, drawings: {}, notes: {} };
  const name = typeof content?.name === "string" && content.name.trim() ? content.name.trim() : "Untitled raid";
  doc.name = text(name, PLAN_LIMITS.maxNameLength, "Plan names");
  if (typeof content.mapKey !== "string" || !content.mapKey || content.mapKey.length > 80) throw new OpError("invalid", "The plan has no map.");
  doc.mapKey = content.mapKey;
  const route = Array.isArray(content.route) ? content.route : [];
  const keys = spreadKeys(route.length);
  const ops: PlanOp[] = [
    ...[...new Set(Array.isArray(content.enabledLayers) ? content.enabledLayers : [])].map((layer): PlanOp => ({ t: "layer.on", layer })),
    ...route.map((waypoint, index): PlanOp => ({ t: "wp.add", id: waypoint.id, at: waypoint.position, ord: keys[index] })),
    ...(Array.isArray(content.drawings) ? content.drawings : []).map((drawing): PlanOp => ({ t: "draw.add", id: drawing.id, kind: drawing.kind, color: drawing.color, points: drawing.points })),
    ...(Array.isArray(content.notes) ? content.notes : []).map(
      (note): PlanOp => ({ t: "note.add", id: note.id, at: note.position, title: note.title, body: note.body ?? "", color: note.color })
    ),
  ];
  return applyOps(doc, ops, { rev, by, maxOps: Number.POSITIVE_INFINITY }).doc;
}

export interface ApplyResult {
  doc: PlanDoc;
  ops: PlanOp[];
  /** Entity keys written ("wp:<id>", "draw:<id>", "note:<id>", "layers", "plan"), for row writes. */
  changed: Set<string>;
  bytes: number;
}

/**
 * Applies a batch atomically (§11.4, §11.5): any refusal throws and nothing changes. Last write wins
 * per field; a delete beats a later update (which is refused as gone); note text is compare-and-set;
 * adds are idempotent by id; every cap and the size are checked.
 */
export function applyOps(source: PlanDoc, rawOps: readonly unknown[], context: { rev: number; by: string | null; maxOps?: number }): ApplyResult {
  if (!Array.isArray(rawOps)) throw new OpError("invalid", "A batch is a list of ops.");
  if (rawOps.length > (context.maxOps ?? PLAN_LIMITS.maxOpsPerBatch)) throw new OpError("invalid", `A batch has at most ${PLAN_LIMITS.maxOpsPerBatch} ops.`);
  const doc: PlanDoc = {
    name: source.name,
    mapKey: source.mapKey,
    layers: [...source.layers],
    waypoints: { ...source.waypoints },
    drawings: { ...source.drawings },
    notes: { ...source.notes },
  };
  const changed = new Set<string>();
  const ops: PlanOp[] = [];
  const { rev, by } = context;
  for (const raw of rawOps) {
    const op = normalizeOp(raw);
    ops.push(op);
    switch (op.t) {
      case "wp.add": {
        if (doc.waypoints[op.id]) break;
        if (Object.keys(doc.waypoints).length >= PLAN_LIMITS.maxRoutePoints) throw capError("route points", PLAN_LIMITS.maxRoutePoints);
        doc.waypoints[op.id] = { id: op.id, ...op.at, ord: op.ord, rev, by };
        changed.add(`wp:${op.id}`);
        break;
      }
      case "wp.move": {
        const current = need(doc.waypoints, op.id, "waypoint");
        const { y: _y, ...rest } = current;
        void _y;
        doc.waypoints[op.id] = { ...rest, ...op.at, rev, by };
        changed.add(`wp:${op.id}`);
        break;
      }
      case "wp.order":
        doc.waypoints[op.id] = { ...need(doc.waypoints, op.id, "waypoint"), ord: op.ord, rev, by };
        changed.add(`wp:${op.id}`);
        break;
      case "wp.del":
        if (doc.waypoints[op.id]) {
          delete doc.waypoints[op.id];
          changed.add(`wp:${op.id}`);
        }
        break;
      case "draw.add": {
        if (doc.drawings[op.id]) break;
        if (Object.keys(doc.drawings).length >= PLAN_LIMITS.maxDrawings) throw capError("drawings", PLAN_LIMITS.maxDrawings);
        const total = Object.values(doc.drawings).reduce((sum, drawing) => sum + drawing.points.length, 0) + op.points.length;
        if (total > PLAN_LIMITS.maxDrawingPoints) {
          throw new OpError("limit", `A plan can hold at most ${PLAN_LIMITS.maxDrawingPoints} drawing points. Erase a drawing first.`, { limit: PLAN_LIMITS.maxDrawingPoints, used: total });
        }
        doc.drawings[op.id] = { id: op.id, kind: op.kind, color: op.color, points: op.points, rev, by };
        changed.add(`draw:${op.id}`);
        break;
      }
      case "draw.del":
        if (doc.drawings[op.id]) {
          delete doc.drawings[op.id];
          changed.add(`draw:${op.id}`);
        }
        break;
      case "note.add": {
        if (doc.notes[op.id]) break;
        if (Object.keys(doc.notes).length >= PLAN_LIMITS.maxNotes) throw capError("notes", PLAN_LIMITS.maxNotes);
        doc.notes[op.id] = { id: op.id, ...op.at, title: op.title, body: op.body, color: op.color, titleRev: rev, bodyRev: rev, rev, by };
        changed.add(`note:${op.id}`);
        break;
      }
      case "note.move": {
        const { y: _y, ...rest } = need(doc.notes, op.id, "note");
        void _y;
        doc.notes[op.id] = { ...rest, ...op.at, rev, by };
        changed.add(`note:${op.id}`);
        break;
      }
      case "note.color":
        doc.notes[op.id] = { ...need(doc.notes, op.id, "note"), color: op.color, rev, by };
        changed.add(`note:${op.id}`);
        break;
      case "note.text": {
        const note = need(doc.notes, op.id, "note");
        const current = op.field === "title" ? note.titleRev : note.bodyRev;
        if (op.base !== current) {
          throw new OpError("conflict", "This note changed while you were editing.", {
            id: op.id,
            field: op.field,
            rev: current,
            value: op.field === "title" ? note.title : note.body,
            by: note.by,
          });
        }
        doc.notes[op.id] = op.field === "title" ? { ...note, title: op.value, titleRev: rev, rev, by } : { ...note, body: op.value, bodyRev: rev, rev, by };
        changed.add(`note:${op.id}`);
        break;
      }
      case "note.del":
        if (doc.notes[op.id]) {
          delete doc.notes[op.id];
          changed.add(`note:${op.id}`);
        }
        break;
      case "layer.on":
        if (!doc.layers.includes(op.layer)) {
          if (doc.layers.length >= PLAN_LIMITS.maxLayers) throw capError("enabled layers", PLAN_LIMITS.maxLayers);
          doc.layers.push(op.layer);
          changed.add("layers");
        }
        break;
      case "layer.off":
        if (doc.layers.includes(op.layer)) {
          doc.layers = doc.layers.filter((layer) => layer !== op.layer);
          changed.add("layers");
        }
        break;
      case "plan.rename":
        doc.name = op.name;
        changed.add("plan");
        break;
    }
  }
  const bytes = planBytes(doc);
  if (bytes > PLAN_LIMITS.maxBytes) {
    throw new OpError("limit", `A raid plan can be at most ${PLAN_LIMITS.maxBytes / 1024} KB. Remove some drawings or notes.`, { limit: PLAN_LIMITS.maxBytes, used: bytes });
  }
  return { doc, ops, changed, bytes };
}

function need<T>(rows: Record<string, T>, key: string, what: string): T {
  const row = rows[key];
  if (!row) throw new OpError("gone", `That ${what} was deleted.`, { id: key });
  return row;
}

function capError(what: string, limit: number) {
  return new OpError("limit", `This plan already has ${limit} ${what}.`, { limit, used: limit });
}

const samePoint = (a: { x: number; z: number; y?: number }, b: GamePoint) =>
  roundCoordinate(a.x) === roundCoordinate(b.x) && roundCoordinate(a.z) === roundCoordinate(b.z) && (a.y === undefined ? b.y === undefined : b.y !== undefined && roundCoordinate(a.y) === roundCoordinate(b.y));

/**
 * The ops that turn the document into the editor's next plan: each user action in the raid planner
 * produces a whole new plan, and this turns it into the small batch live editing sends. New
 * waypoints get order keys between their neighbours; waypoints out of order are re-keyed.
 */
export function diffPlan(doc: PlanDoc, next: RaidPlan, newId: () => string = () => crypto.randomUUID()): PlanOp[] {
  const ops: PlanOp[] = [];
  if (next.name.trim() && next.name.trim() !== doc.name) ops.push({ t: "plan.rename", name: next.name.trim().slice(0, PLAN_LIMITS.maxNameLength) });
  const before = new Set(doc.layers);
  const after = new Set(next.enabledLayers);
  for (const layer of after) if (!before.has(layer)) ops.push({ t: "layer.on", layer });
  for (const layer of before) if (!after.has(layer)) ops.push({ t: "layer.off", layer });

  // Route: keep the longest run of existing waypoints already in order; re-key the others.
  const nextIds = new Set(next.route.map((waypoint) => waypoint.id));
  for (const waypoint of Object.values(doc.waypoints)) if (!nextIds.has(waypoint.id)) ops.push({ t: "wp.del", id: waypoint.id });
  const existing = next.route.filter((waypoint) => doc.waypoints[waypoint.id]);
  const keep = longestOrdered(existing.map((waypoint) => doc.waypoints[waypoint.id]));
  const ords: (string | null)[] = next.route.map((waypoint) => (keep.has(waypoint.id) ? doc.waypoints[waypoint.id].ord : null));
  for (let index = 0; index < next.route.length; index += 1) {
    if (ords[index] !== null) continue;
    const previous = ords.slice(0, index).findLast((ord) => ord !== null) ?? null;
    const following = ords.slice(index + 1).find((ord) => ord !== null) ?? null;
    ords[index] = keyBetween(previous, following);
  }
  next.route.forEach((waypoint, index) => {
    const current = doc.waypoints[waypoint.id];
    const ord = ords[index]!;
    if (!current) ops.push({ t: "wp.add", id: waypoint.id, at: waypoint.position, ord });
    else {
      if (!samePoint(current, waypoint.position)) ops.push({ t: "wp.move", id: waypoint.id, at: waypoint.position });
      if (current.ord !== ord) ops.push({ t: "wp.order", id: waypoint.id, ord });
    }
  });

  const nextDrawings = new Map(next.drawings.map((drawing) => [drawing.id, drawing]));
  for (const drawing of Object.values(doc.drawings)) {
    const updated = nextDrawings.get(drawing.id);
    if (!updated) ops.push({ t: "draw.del", id: drawing.id });
    else if (JSON.stringify(updated.points) !== JSON.stringify(drawing.points) || updated.color.toLowerCase() !== drawing.color || updated.kind !== drawing.kind) {
      // Drawings are immutable once added: a changed one is replaced.
      ops.push({ t: "draw.del", id: drawing.id });
      ops.push({ t: "draw.add", id: newId(), kind: updated.kind, color: updated.color, points: updated.points });
    }
  }
  for (const drawing of next.drawings) {
    if (!doc.drawings[drawing.id]) ops.push({ t: "draw.add", id: drawing.id, kind: drawing.kind, color: drawing.color, points: drawing.points });
  }

  const nextNotes = new Map(next.notes.map((note) => [note.id, note]));
  for (const note of Object.values(doc.notes)) if (!nextNotes.has(note.id)) ops.push({ t: "note.del", id: note.id });
  for (const note of next.notes) {
    const current = doc.notes[note.id];
    if (!current) {
      ops.push({ t: "note.add", id: note.id, at: note.position, title: note.title, body: note.body, color: note.color });
      continue;
    }
    if (!samePoint(current, note.position)) ops.push({ t: "note.move", id: note.id, at: note.position });
    if (note.color.toLowerCase() !== current.color) ops.push({ t: "note.color", id: note.id, color: note.color });
    if (note.title !== current.title) ops.push({ t: "note.text", id: note.id, field: "title", value: note.title, base: current.titleRev });
    if (note.body !== current.body) ops.push({ t: "note.text", id: note.id, field: "body", value: note.body, base: current.bodyRev });
  }
  return ops;
}

function longestOrdered(rows: WaypointRow[]): Set<string> {
  // Longest increasing subsequence by order key, O(n log n).
  const tails: number[] = [];
  const previous: number[] = new Array(rows.length).fill(-1);
  for (let index = 0; index < rows.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (compareOrder(rows[tails[mid]], rows[index]) < 0) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  }
  const keep = new Set<string>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) keep.add(rows[index].id);
  return keep;
}

/**
 * The ops that undo a batch (§11.5): per user, never a whole-plan snapshot, so undo never overwrites
 * other people's edits. Undoing a delete adds the item back under a fresh id. Note text undo is
 * resolved against the current revision when it is sent (base 0 here is a placeholder).
 */
export function inverseOps(before: PlanDoc, ops: readonly PlanOp[], newId: () => string = () => crypto.randomUUID()): PlanOp[] {
  const inverse: PlanOp[] = [];
  for (const op of ops) {
    switch (op.t) {
      case "wp.add":
        if (!before.waypoints[op.id]) inverse.push({ t: "wp.del", id: op.id });
        break;
      case "wp.move": {
        const row = before.waypoints[op.id];
        if (row) inverse.push({ t: "wp.move", id: op.id, at: positionOf(row) });
        break;
      }
      case "wp.order": {
        const row = before.waypoints[op.id];
        if (row) inverse.push({ t: "wp.order", id: op.id, ord: row.ord });
        break;
      }
      case "wp.del": {
        const row = before.waypoints[op.id];
        if (row) inverse.push({ t: "wp.add", id: newId(), at: positionOf(row), ord: row.ord });
        break;
      }
      case "draw.add":
        if (!before.drawings[op.id]) inverse.push({ t: "draw.del", id: op.id });
        break;
      case "draw.del": {
        const row = before.drawings[op.id];
        if (row) inverse.push({ t: "draw.add", id: newId(), kind: row.kind, color: row.color, points: row.points });
        break;
      }
      case "note.add":
        if (!before.notes[op.id]) inverse.push({ t: "note.del", id: op.id });
        break;
      case "note.move": {
        const row = before.notes[op.id];
        if (row) inverse.push({ t: "note.move", id: op.id, at: positionOf(row) });
        break;
      }
      case "note.color": {
        const row = before.notes[op.id];
        if (row) inverse.push({ t: "note.color", id: op.id, color: row.color });
        break;
      }
      case "note.text": {
        const row = before.notes[op.id];
        if (row) inverse.push({ t: "note.text", id: op.id, field: op.field, value: op.field === "title" ? row.title : row.body, base: 0 });
        break;
      }
      case "note.del": {
        const row = before.notes[op.id];
        if (row) inverse.push({ t: "note.add", id: newId(), at: positionOf(row), title: row.title, body: row.body, color: row.color });
        break;
      }
      case "layer.on":
        if (!before.layers.includes(op.layer)) inverse.push({ t: "layer.off", layer: op.layer });
        break;
      case "layer.off":
        if (before.layers.includes(op.layer)) inverse.push({ t: "layer.on", layer: op.layer });
        break;
      case "plan.rename":
        inverse.push({ t: "plan.rename", name: before.name });
        break;
    }
  }
  return inverse.reverse();
}

/** Note text ops carry the current revision, so an undo or redo is last-writer-wins for the person who made it. */
export function withCurrentBases(doc: PlanDoc, ops: readonly PlanOp[]): PlanOp[] {
  return ops.map((op) => (op.t === "note.text" && doc.notes[op.id] ? { ...op, base: op.field === "title" ? doc.notes[op.id].titleRev : doc.notes[op.id].bodyRev } : op));
}

/** The entity an op touches, for presence and the "replaced a newer change" check. */
export function opTarget(op: PlanOp): string | null {
  if (op.t.startsWith("wp.")) return `wp:${(op as { id: string }).id}`;
  if (op.t.startsWith("draw.")) return `draw:${(op as { id: string }).id}`;
  if (op.t.startsWith("note.")) return `note:${(op as { id: string }).id}`;
  return null;
}

export function entityRev(doc: PlanDoc, target: string): number | null {
  const [kind, key] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
  const row = kind === "wp" ? doc.waypoints[key] : kind === "draw" ? doc.drawings[key] : kind === "note" ? doc.notes[key] : undefined;
  return row ? row.rev : null;
}
