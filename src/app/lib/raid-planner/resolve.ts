import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { createId } from "@/app/lib/id";
import { InputError } from "@/app/lib/input-error";
import { normalizeText } from "@/app/lib/search/normalize-text";
import { floorAt, floorName } from "./floors";
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
const SPAWN_LANDMARK_METERS = 150;
const SPAWN_MERGE_METERS = 150;
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
  /** Set for places this app derives, such as an area around a group of key locks. */
  derived?: string;
}

const EXTRACT_ORDER = { pmc: 0, shared: 1, scav: 2 } as const;

/** Named places a route or note can refer to instead of coordinates, most useful first. */
export function placesOf(details: MapDetails): Place[] {
  const extracts = details.extracts.toSorted((a, b) => EXTRACT_ORDER[a.faction] - EXTRACT_ORDER[b.faction]);
  return [
    ...extracts.map((extract) => ({ kind: `${extract.faction} extract`, name: extract.name, position: extract.position })),
    ...details.transits.map((transit) => ({ kind: "transit", name: transit.description, position: transit.position })),
    ...lockAreas(details),
    ...namedSpawnZones(details),
    ...details.switches.flatMap((entry) => (entry.name ? [{ kind: "switch", name: entry.name, position: entry.position }] : [])),
    ...details.hazards.map((hazard) => ({ kind: "hazard", name: hazard.name, position: hazard.position })),
    ...details.stationaryWeapons.map((weapon) => ({ kind: "stationary weapon", name: weapon.name, position: weapon.position })),
    ...details.locks.flatMap((lock) =>
      lock.keyName ? [{ kind: `${lock.lockType} lock`, name: lock.keyName, position: lock.position }] : []
    ),
  ];
}

/** A readable spawn zone name, or null for unnamed (UUID) zones. */
export function spawnZoneName(zoneName: string | null, label?: string | null) {
  if (label) return label;
  if (!zoneName || UUID_PATTERN.test(zoneName)) return null;
  return zoneName
    .replace(/^(Bot)?Zone_?/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim() || null;
}

/** One place per named spawn zone and kind, at the centre of its spawn points. */
function namedSpawnZones(details: MapDetails): Place[] {
  const zones = new Map<string, { kind: string; name: string; points: GamePoint[] }>();
  for (const spawn of details.spawns) {
    const name = spawnZoneName(spawn.zoneName, spawn.zoneLabel);
    if (!name) continue;
    const key = `${spawn.kind}|${name}`;
    const zone = zones.get(key) ?? { kind: `${spawn.kind} spawn`, name, points: [] };
    zone.points.push(spawn.position);
    zones.set(key, zone);
  }
  return Array.from(zones.values(), (zone) => ({ kind: zone.kind, name: zone.name, position: centre(zone.points) }));
}

const LOCK_AREA_SPREAD_METERS = 150;

function keyStem(keyName: string) {
  return keyName
    .replace(/\s*\(.*?\)/g, "")
    .replace(/\s*\b(?:marked\s+)?key(?:\s?card)?\b.*$/i, "")
    .trim();
}

/**
 * Areas named after groups of key locks, such as "Dorm" from the Dorm room keys on Customs.
 * A group needs three different keys, or two whose names share at least two words, all
 * within 150 m of their centre.
 */
export function lockAreas(details: MapDetails): Place[] {
  const groups = new Map<string, { key: string; words: string[]; position: GamePoint }[]>();
  for (const lock of details.locks) {
    if (!lock.keyName) continue;
    const words = keyStem(lock.keyName).split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const group = groups.get(words[0].toLowerCase()) ?? [];
    group.push({ key: lock.keyName, words, position: lock.position });
    groups.set(words[0].toLowerCase(), group);
  }
  const areas: Place[] = [];
  for (const group of groups.values()) {
    const keys = new Set(group.map((entry) => entry.key)).size;
    if (keys < 2) continue;
    const prefix: string[] = [];
    for (let index = 0; group.every((entry) => index < entry.words.length); index += 1) {
      const word = group[0].words[index];
      if (!group.every((entry) => entry.words[index].toLowerCase() === word.toLowerCase())) break;
      prefix.push(word);
    }
    if (keys < 3 && prefix.length < 2) continue;
    const middle = centre(group.map((entry) => entry.position));
    const spread = Math.max(...group.map((entry) => Math.hypot(entry.position.x - middle.x, entry.position.z - middle.z)));
    if (spread > LOCK_AREA_SPREAD_METERS) continue;
    areas.push({
      kind: "area",
      name: prefix.join(" "),
      position: { x: middle.x, z: middle.z },
      derived: `centre of ${keys} ${prefix.join(" ")} key locks`,
    });
  }
  return areas;
}

/** Groups named spawns by zone and clusters unnamed spawns on the same level by distance. */
export function spawnZones(config: MapConfig, details: MapDetails) {
  interface Zone {
    kind: string;
    zone: string | null;
    zoneId: string | null;
    level: string | null;
    points: GamePoint[];
  }
  const zones: Zone[] = [];
  const named = new Map<string, Zone>();
  for (const spawn of details.spawns) {
    const zoneName = spawnZoneName(spawn.zoneName, spawn.zoneLabel);
    if (zoneName) {
      const key = `${spawn.kind}|${zoneName}`;
      const zone = named.get(key);
      if (zone) zone.points.push(spawn.position);
      else {
        const created = { kind: spawn.kind, zone: zoneName, zoneId: spawn.zoneName, level: null, points: [spawn.position] };
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
    else zones.push({ kind: spawn.kind, zone: null, zoneId: null, level, points: [spawn.position] });
  }
  // Unnamed clusters of one kind near the same landmark merge, such as the PMC spawns by an extract.
  const landmarks = placesOf(details).filter((place) => /extract|transit|area|spawn/.test(place.kind));
  const merged: (Zone & { near: string | null })[] = [];
  for (const zone of zones) {
    const near = zone.zone ? null : nearestName(landmarks, centre(zone.points), SPAWN_LANDMARK_METERS);
    const into =
      near &&
      merged.find(
        (other) =>
          other.near === near &&
          other.kind === zone.kind &&
          other.level === zone.level &&
          Math.hypot(centre(other.points).x - centre(zone.points).x, centre(other.points).z - centre(zone.points).z) <=
            SPAWN_MERGE_METERS
      );
    if (into) into.points.push(...zone.points);
    else merged.push({ ...zone, near, points: [...zone.points] });
  }
  return merged.map((zone) => {
    const middle = centre(zone.points);
    return {
      kind: zone.kind,
      zone: zone.zone,
      zoneId: zone.zoneId,
      ...(zone.near ? { near: zone.near } : {}),
      points: zone.points.length,
      // A centre's height means little, so only its level is given.
      x: Math.round(middle.x),
      z: Math.round(middle.z),
      level: zone.zone ? floorAt(config, middle).name : floorName(config, zone.level),
    };
  });
}

function nearestName(places: Place[], position: GamePoint, limit: number) {
  let best: { name: string; distance: number } | null = null;
  for (const place of places) {
    const distance = Math.hypot(place.position.x - position.x, place.position.z - position.z);
    if (distance <= limit && (!best || distance < best.distance)) best = { name: place.name, distance };
  }
  return best?.name ?? null;
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

// Place names are compared the way players type them: case, accents, apostrophes, hyphens,
// spacing, and plural "s" are ignored, and small typos are tolerated.

function placeWords(value: string) {
  return normalizeText(value)
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
}

const FILLER_WORDS = new Set(["the", "extract", "extraction", "exfil", "exit"]);

/** Edit distance with adjacent transpositions, giving up above `limit`. */
function editDistance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previousRow: number[] = [];
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, previousRow[j - 2] + 1);
      next.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    previousRow = row;
    row = next;
  }
  return row[b.length];
}

/** How many typos a name of this length can have and still match on its own. */
function typoAllowance(length: number) {
  return length <= 3 ? 0 : length <= 8 ? 1 : 2;
}

export type PlaceMatch =
  | {
      place: Place;
      /** exact: same name apart from case and punctuation; partial: the name contains the words given; typo: a close spelling. */
      match: "exact" | "partial" | "typo";
      /** Other places with the same name, such as the scav side of an extract. */
      others: Place[];
    }
  | { error: string };

function distinctByName(places: Place[]) {
  const groups = new Map<string, Place[]>();
  for (const place of places) {
    const key = placeWords(place.name).join("");
    groups.set(key, [...(groups.get(key) ?? []), place]);
  }
  return Array.from(groups.values());
}

function label(place: Place) {
  return `${place.name} (${place.kind})`;
}

/** Matches a place name, from exact to a close spelling; never throws. */
export function matchPlace(places: Place[], reference: string): PlaceMatch {
  const given = placeWords(reference);
  // "the Smugglers' Boat extract" means Smugglers' Boat.
  const meaningful = given.filter((word) => !FILLER_WORDS.has(word));
  const words = meaningful.length ? meaningful : given;
  const compact = words.join("");
  if (!compact) return { error: `"${reference}" is not a place name.` };
  const indexed = places.map((place) => ({ place, words: placeWords(place.name) }));
  const found = (group: Place[], match: "exact" | "partial" | "typo") => ({
    place: group[0],
    match,
    others: group.slice(1).filter((other) => other.name !== group[0].name || other.kind !== group[0].kind),
  });

  const exact = indexed.filter((entry) => entry.words.join("") === compact).map((entry) => entry.place);
  if (exact.length > 0) return found(exact, "exact");

  const partial = distinctByName(
    indexed
      .filter(
        (entry) =>
          words.every((word) => entry.words.some((candidate) => candidate.startsWith(word))) ||
          (compact.length >= 2 && entry.words.join("").includes(compact))
      )
      .map((entry) => entry.place)
  ).toSorted((a, b) => {
    // Names that start with the words given come first, then shorter names.
    const starts = (group: Place[]) => (placeWords(group[0].name).join("").startsWith(compact) ? 0 : 1);
    return starts(a) - starts(b) || a[0].name.length - b[0].name.length;
  });
  if (partial.length === 1) return found(partial[0], "partial");
  if (partial.length > 1) {
    return {
      error: `"${reference}" matches several places: ${partial
        .slice(0, 10)
        .map((group) => label(group[0]))
        .join("; ")}. Use the full name.`,
    };
  }

  const limit = Math.max(2, Math.ceil(compact.length / 3));
  const scored = distinctByName(places)
    .map((group) => {
      const candidate = placeWords(group[0].name);
      const whole = editDistance(compact, candidate.join(""), limit);
      // A misspelt word of a longer name, such as "smuglers" for Smugglers' Boat, makes a suggestion only.
      const wordHit = words.some(
        (word) => word.length >= 4 && candidate.some((other) => editDistance(word, other, 1) <= 1)
      );
      return { group, whole, score: wordHit ? Math.min(whole, limit) : whole };
    })
    .filter((entry) => entry.score <= limit)
    .toSorted((a, b) => a.score - b.score || a.whole - b.whole);
  const [best, second] = scored;
  if (best && best.whole <= typoAllowance(compact.length) && (!second || second.whole > best.whole)) {
    return found(best.group, "typo");
  }
  const suggestions = scored.slice(0, 5).map((entry) => label(entry.group[0]));
  return {
    error: `No place is named "${reference}".${suggestions.length ? ` Did you mean ${suggestions.join("; ")}?` : ""}`,
  };
}

export const PLACE_HELP =
  "Places are extracts, transits, areas, spawn zones, switches, hazards, stationary weapons, and key locks (by key name). Use get_map_details to list them, or give x and z coordinates.";

export function findPlace(places: Place[], reference: string): Place {
  const result = matchPlace(places, reference);
  if ("error" in result) throw new InputError(`${result.error} ${PLACE_HELP}`);
  return result.place;
}

/** "Name (kind, 12 m)" for the closest place within 30 m, or null. Adds the level when it is not the base level. */
export function nearestPlace(places: Place[], position: GamePoint, config?: MapConfig) {
  let best: { place: Place; distance: number } | null = null;
  for (const place of places) {
    const distance = Math.hypot(place.position.x - position.x, place.position.z - position.z);
    if (distance <= NEAREST_PLACE_METERS && (!best || distance < best.distance)) best = { place, distance };
  }
  if (!best) return null;
  const level = config && typeof best.place.position.y === "number" ? floorAt(config, best.place.position) : null;
  return `${best.place.name} (${best.place.kind}, ${Math.round(best.distance)} m${level?.id ? `, ${level.name}` : ""})`;
}

/** The rectangle a plan's points should fall in: the map and its data, with a 10% margin. */
export function planArea(config: MapConfig, details: MapDetails | null) {
  const xs = [config.bounds[0][0], config.bounds[1][0]];
  const zs = [config.bounds[0][1], config.bounds[1][1]];
  if (details) {
    for (const entry of [...details.extracts, ...details.transits, ...details.spawns, ...details.locks]) {
      xs.push(entry.position.x);
      zs.push(entry.position.z);
    }
  }
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  const marginX = (box.maxX - box.minX) * 0.1;
  const marginZ = (box.maxZ - box.minZ) * 0.1;
  return {
    minX: Math.floor(box.minX - marginX),
    maxX: Math.ceil(box.maxX + marginX),
    minZ: Math.floor(box.minZ - marginZ),
    maxZ: Math.ceil(box.maxZ + marginZ),
  };
}

export type PlanArea = ReturnType<typeof planArea>;

export function isInArea(area: PlanArea, point: GamePoint) {
  return point.x >= area.minX && point.x <= area.maxX && point.z >= area.minZ && point.z <= area.maxZ;
}

/** A plan colour from a name or hex value, falling back with a warning instead of failing. */
export function matchColor(value: string | undefined, fallback: PlanColor): { color: PlanColor; warning?: string } {
  if (!value) return { color: fallback };
  const normalized = value.trim().toLowerCase();
  const match = COLOR_NAMES[normalized] ?? PLAN_COLORS.find((candidate) => candidate === normalized);
  if (match) return { color: match };
  return {
    color: fallback,
    warning: `Colour "${value}" is not available, so ${colorName(fallback)} was used. Colours: ${Object.keys(COLOR_NAMES).join(", ")}.`,
  };
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
