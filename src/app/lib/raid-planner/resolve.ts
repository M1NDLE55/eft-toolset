import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { createId } from "@/app/lib/id";
import { InputError } from "@/app/lib/input-error";
import { normalizeText } from "@/app/lib/search/normalize-text";
import { floorAt } from "./floors";
import { mapConfigs } from "./maps-config";
import { decodePlanSharePayload, type DecodedSharedPlan } from "./share";
import { PLAN_COLORS, type GamePoint, type MapConfig, type RaidPlan } from "./types";

type PlanColor = (typeof PLAN_COLORS)[number];

export const COLOR_NAMES: Record<string, PlanColor> = {
  tan: PLAN_COLORS[0],
  green: PLAN_COLORS[1],
  orange: PLAN_COLORS[2],
  red: PLAN_COLORS[3],
  blue: PLAN_COLORS[4],
  white: PLAN_COLORS[5],
};

const MAP_ALIASES: Record<string, string> = {
  lab: "the-lab",
  labs: "the-lab",
  labyrinth: "the-labyrinth",
  streets: "streets-of-tarkov",
  gz: "ground-zero",
  "ground zero 21": "ground-zero",
  ib: "icebreaker",
};
const NEAREST_PLACE_METERS = 30;
const SPAWN_CLUSTER_METERS = 40;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Finds a map by key, name, or common short name such as "labs" or "streets". */
export function resolveMap(reference: string): MapConfig {
  const needle = normalizeText(reference).replace(/^the\s+/, "");
  const alias = MAP_ALIASES[needle];
  if (alias) return mapConfigs.find((config) => config.key === alias)!;
  const exact = mapConfigs.find(
    (config) =>
      config.key === reference.trim() ||
      normalizeText(config.name) === normalizeText(reference) ||
      normalizeText(config.name).replace(/^the\s+/, "") === needle ||
      config.key.replace(/-/g, " ") === needle
  );
  if (exact) return exact;
  const partial = mapConfigs.filter(
    (config) => normalizeText(config.name).includes(needle) || config.key.includes(needle.replace(/\s+/g, "-"))
  );
  if (partial.length === 1) return partial[0];
  throw new InputError(
    `${partial.length > 1 ? `"${reference}" matches several maps` : `No map matches "${reference}"`}. Maps: ${mapConfigs
      .map((config) => `${config.name} (${config.key})`)
      .join(", ")}.`
  );
}

function roundTo(value: number) {
  return Math.round(value * 10) / 10;
}

/** A position rounded to decimetres, with the name of the level it is on. */
export function describePosition(config: MapConfig, position: GamePoint) {
  return {
    x: roundTo(position.x),
    z: roundTo(position.z),
    ...(typeof position.y === "number" ? { y: roundTo(position.y) } : {}),
    level: floorAt(config, position).name,
  };
}

export interface Place {
  kind: string;
  name: string;
  position: GamePoint;
}

/** Named places a route or note can refer to instead of coordinates. */
export function placesOf(details: MapDetails): Place[] {
  return [
    ...details.extracts.map((extract) => ({ kind: `${extract.faction} extract`, name: extract.name, position: extract.position })),
    ...details.transits.map((transit) => ({ kind: "transit", name: transit.description, position: transit.position })),
    ...details.switches.flatMap((entry) => (entry.name ? [{ kind: "switch", name: entry.name, position: entry.position }] : [])),
    ...details.hazards.map((hazard) => ({ kind: "hazard", name: hazard.name, position: hazard.position })),
    ...details.stationaryWeapons.map((weapon) => ({ kind: "stationary weapon", name: weapon.name, position: weapon.position })),
    ...details.locks.flatMap((lock) =>
      lock.keyName ? [{ kind: `${lock.lockType} lock`, name: lock.keyName, position: lock.position }] : []
    ),
    ...details.spawns.flatMap((spawn) => {
      const name = spawnZoneName(spawn.zoneName);
      return name ? [{ kind: `${spawn.kind} spawn`, name, position: spawn.position }] : [];
    }),
  ];
}

/** A readable spawn zone name, or null for unnamed (UUID) zones. */
export function spawnZoneName(zoneName: string | null) {
  if (!zoneName || UUID_PATTERN.test(zoneName)) return null;
  return zoneName
    .replace(/^Zone_?/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim() || null;
}

/** Groups named spawns by zone and clusters unnamed spawns on the same level by distance. */
export function spawnZones(config: MapConfig, details: MapDetails) {
  interface Zone {
    kind: string;
    zone: string | null;
    level: string | null;
    points: GamePoint[];
  }
  const zones: Zone[] = [];
  const named = new Map<string, Zone>();
  for (const spawn of details.spawns) {
    const zoneName = spawnZoneName(spawn.zoneName);
    if (zoneName) {
      const key = `${spawn.kind}|${zoneName}`;
      const zone = named.get(key);
      if (zone) zone.points.push(spawn.position);
      else {
        const created = { kind: spawn.kind, zone: zoneName, level: null, points: [spawn.position] };
        named.set(key, created);
        zones.push(created);
      }
      continue;
    }
    const level = floorAt(config, spawn.position).id;
    const cluster = zones.find(
      (zone) =>
        zone.zone === null &&
        zone.kind === spawn.kind &&
        zone.level === level &&
        Math.hypot(centre(zone.points).x - spawn.position.x, centre(zone.points).z - spawn.position.z) <=
          SPAWN_CLUSTER_METERS
    );
    if (cluster) cluster.points.push(spawn.position);
    else zones.push({ kind: spawn.kind, zone: null, level, points: [spawn.position] });
  }
  return zones.map((zone) => ({
    kind: zone.kind,
    zone: zone.zone,
    points: zone.points.length,
    ...describePosition(config, centre(zone.points)),
  }));
}

function centre(points: GamePoint[]): GamePoint {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const entry of points) {
    x += entry.x;
    y += entry.y ?? 0;
    z += entry.z;
  }
  return { x: x / points.length, y: y / points.length, z: z / points.length };
}

export function findPlace(places: Place[], reference: string): Place {
  const needle = normalizeText(reference);
  const exact = places.filter((place) => normalizeText(place.name) === needle);
  if (exact.length > 0) return exact[0];
  const partial = places.filter((place) => normalizeText(place.name).includes(needle));
  const distinct = Array.from(new Map(partial.map((place) => [`${place.kind}:${place.name}`, place])).values());
  if (distinct.length === 1) return distinct[0];
  if (distinct.length > 1) {
    throw new InputError(
      `"${reference}" matches several places: ${distinct
        .slice(0, 10)
        .map((place) => `${place.name} (${place.kind})`)
        .join("; ")}. Use the exact name.`
    );
  }
  throw new InputError(
    `No extract, transit, switch, hazard, stationary weapon, key lock, or spawn zone is named "${reference}". Use get_map_details to list places, or give x and z coordinates.`
  );
}

/** "Name (kind, 12 m)" for the closest place within 30 m, or null. */
export function nearestPlace(places: Place[], position: GamePoint) {
  let best: { place: Place; distance: number } | null = null;
  for (const place of places) {
    const distance = Math.hypot(place.position.x - position.x, place.position.z - position.z);
    if (distance <= NEAREST_PLACE_METERS && (!best || distance < best.distance)) best = { place, distance };
  }
  return best ? `${best.place.name} (${best.place.kind}, ${Math.round(best.distance)} m)` : null;
}

export function resolveColor(value: string | undefined, fallback: PlanColor): PlanColor {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  const match = COLOR_NAMES[normalized] ?? PLAN_COLORS.find((candidate) => candidate === normalized);
  if (!match) {
    throw new InputError(
      `Colour "${value}" is not available. Use ${Object.keys(COLOR_NAMES).join(", ")} or ${PLAN_COLORS.join(", ")}.`
    );
  }
  return match;
}

export function colorName(hex: string) {
  return Object.entries(COLOR_NAMES).find(([, value]) => value === hex)?.[0] ?? hex;
}

function payloadFromLink(link: string) {
  const value = link.trim();
  const hashIndex = value.indexOf("#");
  if (hashIndex === -1) return value;
  const payload = new URLSearchParams(value.slice(hashIndex + 1)).get("p");
  if (!payload) throw new InputError("This link has no plan data. Make sure the whole link was copied.");
  return payload;
}

/** Decodes a raid plan share link or its bare payload. */
export async function decodePlanLink(link: string): Promise<DecodedSharedPlan> {
  try {
    return await decodePlanSharePayload(payloadFromLink(link));
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("This plan link is damaged or was created by an incompatible version.");
  }
}

export function planFromShared(shared: DecodedSharedPlan, now = Date.now()): RaidPlan {
  return { id: createId(), createdAt: now, updatedAt: now, ...shared };
}
