import type { GamePoint } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A readable name for a spawn zone, or null when the game only gives it an id. */
export function spawnZoneName(zoneName: string | null, label?: string | null) {
  if (label) return label;
  if (!zoneName || UUID_PATTERN.test(zoneName)) return null;
  return zoneName
    .replace(/^(Bot)?Zone_?/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim() || null;
}

/** Spawn points this close together, in metres, belong to the same area. */
export const SPAWN_AREA_LINK_METERS = 20;
/** Points more than this far apart in height are on different floors. */
export const SPAWN_AREA_LINK_HEIGHT = 3;
/** How far an area reaches past its outermost spawn points, in metres. */
export const SPAWN_AREA_PADDING_METERS = 7;
const OUTLINE_STEPS = 16;

export interface SpawnAreaPoint {
  position: Required<GamePoint>;
  zoneName: string | null;
  zoneLabel?: string | null;
}

export interface SpawnArea {
  /** Rounded outline around the area's spawn points, in game coordinates. */
  outline: GamePoint[];
  /** The middle of the area, at the average height of its points. */
  centre: Required<GamePoint>;
  top: number;
  bottom: number;
  count: number;
  /** The most common readable zone name among the points. */
  zone: string | null;
}

/**
 * Groups spawn points into rough areas: points within linking distance of each
 * other (on the same floor) join one area, outlined as a padded convex hull.
 */
export function spawnAreas(points: SpawnAreaPoint[]): SpawnArea[] {
  const parent = points.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };

  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i].position;
      const b = points[j].position;
      if (
        Math.hypot(a.x - b.x, a.z - b.z) <= SPAWN_AREA_LINK_METERS &&
        Math.abs(a.y - b.y) <= SPAWN_AREA_LINK_HEIGHT
      ) {
        parent[root(i)] = root(j);
      }
    }
  }

  const groups = new Map<number, SpawnAreaPoint[]>();
  points.forEach((point, index) => {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), point]);
  });

  return Array.from(groups.values(), (group) => {
    const positions = group.map((point) => point.position);
    const heights = positions.map((position) => position.y);
    return {
      outline: paddedHull(positions, SPAWN_AREA_PADDING_METERS),
      centre: {
        x: average(positions.map((position) => position.x)),
        y: average(heights),
        z: average(positions.map((position) => position.z)),
      },
      top: Math.max(...heights),
      bottom: Math.min(...heights),
      count: group.length,
      zone: commonZone(group),
    };
  });
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function commonZone(group: SpawnAreaPoint[]) {
  const counts = new Map<string, number>();
  for (const point of group) {
    const name = spawnZoneName(point.zoneName, point.zoneLabel);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/** The convex hull of a circle around every point, which rounds the hull's corners. */
function paddedHull(positions: GamePoint[], padding: number): GamePoint[] {
  const ring: GamePoint[] = [];
  for (const { x, z } of positions) {
    for (let step = 0; step < OUTLINE_STEPS; step += 1) {
      const angle = (step / OUTLINE_STEPS) * Math.PI * 2;
      ring.push({ x: x + Math.cos(angle) * padding, z: z + Math.sin(angle) * padding });
    }
  }
  return convexHull(ring);
}

function convexHull(points: GamePoint[]): GamePoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: GamePoint, a: GamePoint, b: GamePoint) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (input: GamePoint[]) => {
    const hull: GamePoint[] = [];
    for (const point of input) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    hull.pop();
    return hull;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
