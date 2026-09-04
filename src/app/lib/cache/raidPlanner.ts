import type { GameMode } from "@/components/game-mode/context";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { apiFetch } from "@/app/lib/api/transport";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import { ensureQuery, type QueryDefinition } from "@/app/lib/api/queryClient";

export async function fetchMapDetails(
  mapKey: string,
  gameMode: GameMode
): Promise<MapDetails | null> {
  return ensureQuery(mapDetailsQuery, { mapKey, gameMode });
}

interface MapDetailsVariables {
  mapKey: string;
  gameMode: GameMode;
}

export const mapDetailsQuery: QueryDefinition<MapDetailsVariables, MapDetails | null> = {
  id: "map-details",
  version: 3,
  staleTime: 1000 * 60 * 60,
  maxAge: 1000 * 60 * 60 * 24 * 7,
  persist: true,
  validate: (value): value is MapDetails | null => value === null || isMapDetails(value),
  fetch: ({ mapKey, gameMode }, signal) =>
    apiFetch<MapDetails | null>(
      TARKOV_OPERATIONS.mapDetails,
      { gameMode, mapKey },
      { signal }
    ),
};

function isMapDetails(value: unknown): value is MapDetails {
  if (!value || typeof value !== "object") return false;
  const map = value as Partial<MapDetails>;
  const arrays = [
    map.extracts,
    map.transits,
    map.spawns,
    map.locks,
    map.hazards,
    map.lootContainers,
    map.switches,
    map.stationaryWeapons,
  ];
  if (typeof map.key !== "string" || arrays.some((entries) => !Array.isArray(entries) || entries.length > 20_000)) return false;
  const positioned = arrays.flat();
  return positioned.every((entry) => {
    if (!isBoundedObject(entry) || !isPoint(entry.position)) return false;
    const outline = entry.outline;
    return outline === undefined || (Array.isArray(outline) && outline.every(isPoint));
  });
}

function isPoint(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof point.x === "number" && Number.isFinite(point.x) &&
    typeof point.z === "number" && Number.isFinite(point.z) &&
    (point.y === undefined || (typeof point.y === "number" && Number.isFinite(point.y)))
  );
}

function isBoundedObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const entry of Object.values(value)) {
    if (typeof entry === "number" && !Number.isFinite(entry)) return false;
    if (typeof entry === "string" && entry.length > 10_000) return false;
    if (Array.isArray(entry) && (entry.length > 20_000 || !entry.every(isBoundedObject))) return false;
    if (entry && typeof entry === "object" && !Array.isArray(entry) && !isBoundedObject(entry)) return false;
  }
  return true;
}
