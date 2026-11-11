import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { createId } from "@/app/lib/id";
import { InputError } from "@/app/lib/input-error";
import { normalizeText } from "@/app/lib/search/normalize-text";
import { editDistance, nameWords, typoAllowance } from "@/app/lib/search/name-match";
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

const placeLists = new WeakMap<MapDetails, Place[]>();

/**
 * Named places a route or note can refer to instead of coordinates, most useful first. The
 * list is built once per map data, so its name index is reused across calls.
 */
export function placesOf(details: MapDetails): Place[] {
  let places = placeLists.get(details);
  if (!places) {
    places = collectPlaces(details);
    placeLists.set(details, places);
  }
  return places;
}

function collectPlaces(details: MapDetails): Place[] {
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
/** A lock area may span at most this fraction of the map's extent. */
const LOCK_AREA_MAP_FRACTION = 1 / 6;

/** The diagonal of the box holding the map's extracts, transits, spawns, and locks, in metres. */
function mapExtent(details: MapDetails) {
  const points = [...details.extracts, ...details.transits, ...details.spawns, ...details.locks].map((entry) => entry.position);
  if (points.length === 0) return 0;
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
}

function keyStem(keyName: string) {
  return keyName
    .replace(/\s*\(.*?\)/g, "")
    .replace(/\s*\b(?:marked\s+)?key(?:\s?card)?\b.*$/i, "")
    .trim();
}

/**
 * Areas named after groups of key locks, such as "Dorm" from the Dorm room keys on Customs.
 * A group needs three different keys, or two whose names share at least two words, all
 * within 150 m of their centre and within a sixth of the map's extent: on a small map such
 * as the Lab, 150 m spans the whole map, and the centre of locks spread across it is no place.
 */
export function lockAreas(details: MapDetails): Place[] {
  const maxSpread = Math.min(LOCK_AREA_SPREAD_METERS, mapExtent(details) * LOCK_AREA_MAP_FRACTION);
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
    if (spread > maxSpread) continue;
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

const FILLER_WORDS = new Set(["the", "extract", "extraction", "exfil", "exit"]);

export type PlaceMatch =
  | {
      place: Place;
      /** exact: same name apart from case and punctuation; partial: the name contains the words given; typo: a close spelling. */
      match: "exact" | "partial" | "typo";
      /** Other places with the same name, such as the scav side of an extract. */
      others: Place[];
    }
  | { error: string };

interface IndexedPlace {
  place: Place;
  words: string[];
  compact: string;
}

/** Places with their words worked out once, so matching a name costs one pass over them. */
interface PlaceIndex {
  entries: IndexedPlace[];
  byCompact: Map<string, Place[]>;
  /** One group per distinct name, in place order, for suggestions and typo matching. */
  groups: IndexedPlace[][];
  longestCompact: number;
}

const placeIndexes = new WeakMap<readonly Place[], PlaceIndex>();

function indexPlaces(places: readonly Place[]): PlaceIndex {
  let index = placeIndexes.get(places);
  if (!index) {
    const entries = places.map((place) => {
      const words = nameWords(place.name);
      return { place, words, compact: words.join("") };
    });
    const groupOf = new Map<string, IndexedPlace[]>();
    for (const entry of entries) {
      const group = groupOf.get(entry.compact);
      if (group) group.push(entry);
      else groupOf.set(entry.compact, [entry]);
    }
    index = {
      entries,
      byCompact: new Map([...groupOf].map(([key, group]) => [key, group.map((entry) => entry.place)])),
      groups: [...groupOf.values()],
      longestCompact: Math.max(0, ...entries.map((entry) => entry.compact.length)),
    };
    placeIndexes.set(places, index);
  }
  return index;
}

function label(place: Place) {
  return `${place.name} (${place.kind})`;
}

/** Words of a reference that count for typo matching, and the longest reference it tries. */
const MAX_TYPO_WORDS = 8;
const MAX_TYPO_LENGTH = 60;

export interface PlaceMatchOptions {
  /** False to skip typo matching and suggestions, once a request has spent its budget. */
  typos?: boolean;
}

/** Matches a place name, from exact to a close spelling; never throws. */
export function matchPlace(places: readonly Place[], reference: string, options: PlaceMatchOptions = {}): PlaceMatch {
  const given = nameWords(reference);
  // "the Smugglers' Boat extract" means Smugglers' Boat.
  const meaningful = given.filter((word) => !FILLER_WORDS.has(word));
  const words = meaningful.length ? meaningful : given;
  const compact = words.join("");
  if (!compact) return { error: `"${reference}" is not a place name.` };
  const index = indexPlaces(places);
  const found = (group: Place[], match: "exact" | "partial" | "typo") => ({
    place: group[0],
    match,
    others: group.slice(1).filter((other) => other.name !== group[0].name || other.kind !== group[0].kind),
  });

  const exact = index.byCompact.get(compact);
  if (exact) return found(exact, "exact");

  // A reference longer than every name can't be part of one.
  const partialGroups =
    compact.length > index.longestCompact
      ? []
      : index.groups
          .filter((group) =>
            group.some(
              (entry) =>
                words.every((word) => entry.words.some((candidate) => candidate.startsWith(word))) ||
                (compact.length >= 2 && entry.compact.includes(compact))
            )
          )
          .toSorted((a, b) => {
            // Names that start with the words given come first, then shorter names.
            const starts = (group: IndexedPlace[]) => (group[0].compact.startsWith(compact) ? 0 : 1);
            return starts(a) - starts(b) || a[0].place.name.length - b[0].place.name.length;
          })
          .map((group) => group.map((entry) => entry.place));
  if (partialGroups.length === 1) return found(partialGroups[0], "partial");
  if (partialGroups.length > 1) {
    return {
      error: `"${reference}" matches several places: ${partialGroups
        .slice(0, 10)
        .map((group) => label(group[0]))
        .join("; ")}. Use the full name.`,
    };
  }

  if (options.typos === false || compact.length > MAX_TYPO_LENGTH) return { error: `No place is named "${reference}".` };
  const limit = Math.max(2, Math.ceil(compact.length / 3));
  const typoWords = words.filter((word) => word.length >= 4).slice(0, MAX_TYPO_WORDS);
  const scored = index.groups
    .map((group) => {
      const candidate = group[0];
      const whole = editDistance(compact, candidate.compact, limit);
      // A misspelt word of a longer name, such as "smuglers" for Smugglers' Boat, makes a suggestion only.
      const wordHit = typoWords.some((word) => candidate.words.some((other) => editDistance(word, other, 1) <= 1));
      return { group: group.map((entry) => entry.place), whole, score: wordHit ? Math.min(whole, limit) : whole };
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
  "Places are extracts, transits, areas, spawn zones, switches, hazards, stationary weapons, key locks (by key name), and landmarks such as Big Red (lookup_term lists a map's). Use get_map_details to list the rest, or give x and z coordinates.";

export function findPlace(places: readonly Place[], reference: string): Place {
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
