import type { BuildNode } from "@/app/lib/types/gunBuilder";
import type { GamePoint } from "@/app/lib/raid-planner/types";
import type { BuildContent } from "./build-patch";
import type { GroupContent } from "./group-patch";
import type { PlanContent } from "./plan-content";
import { sha256Hex } from "./sha256";

/**
 * Content hashes: SHA-256 of an item's canonical content, the fields that make it what it is
 * without ids or timestamps. Migration and restore skip items whose hash the account already has,
 * so moving the same library twice, or from two devices, never makes duplicates.
 */
const sha256 = sha256Hex;

function canonicalTree(node: BuildNode): unknown {
  return [node.itemId, Object.keys(node.slots).sort().map((slot) => [slot, canonicalTree(node.slots[slot])])];
}

export function buildHash(build: BuildContent) {
  return sha256(JSON.stringify(["build", build.name, build.weaponId, build.ammoId ?? null, canonicalTree(build.root)]));
}

export function groupHash(group: GroupContent) {
  return sha256(JSON.stringify(["group", group.name.toLowerCase(), [...group.items].sort()]));
}

/** Coordinates rounded to 0.01 m, as plans store them. */
export function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function point(at: GamePoint) {
  return at.y === undefined ? [roundCoordinate(at.x), roundCoordinate(at.z)] : [roundCoordinate(at.x), roundCoordinate(at.z), roundCoordinate(at.y)];
}

export function planHash(plan: PlanContent) {
  return sha256(
    JSON.stringify([
      "plan",
      plan.name,
      plan.mapKey,
      [...plan.enabledLayers].sort(),
      plan.route.map((waypoint) => point(waypoint.position)),
      plan.drawings.map((drawing) => [drawing.kind, drawing.color.toLowerCase(), drawing.points.map(point)]),
      plan.notes.map((note) => [point(note.position), note.title, note.body, note.color.toLowerCase()]),
    ])
  );
}
