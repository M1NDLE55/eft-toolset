import type { GameMode } from "@/components/game-mode/context";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { apiFetch } from "@/app/lib/api/transport";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import { ensureQuery, type QueryDefinition } from "@/app/lib/api/queryClient";

export async function fetchMapDetails(
  mapKey: string,
  mapName: string,
  gameMode: GameMode
): Promise<MapDetails | null> {
  return ensureQuery(mapDetailsQuery, { mapKey, mapName, gameMode });
}

interface MapDetailsVariables {
  mapKey: string;
  mapName: string;
  gameMode: GameMode;
}

export const mapDetailsQuery: QueryDefinition<MapDetailsVariables, MapDetails | null> = {
  id: "map-details",
  version: 3,
  staleTime: 1000 * 60 * 60,
  maxAge: 1000 * 60 * 60 * 24 * 7,
  persist: true,
  validate: (value): value is MapDetails | null =>
    value === null ||
    (Boolean(value) &&
      typeof value === "object" &&
      typeof (value as MapDetails).key === "string" &&
      Array.isArray((value as MapDetails).extracts)),
  fetch: ({ mapKey, gameMode }, signal) =>
    apiFetch<MapDetails | null>(
      TARKOV_OPERATIONS.mapDetails,
      { gameMode, mapKey },
      { signal }
    ),
};
