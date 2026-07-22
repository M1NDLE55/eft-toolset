import type { GameMode } from "@/components/game-mode/context";
import type {
  ExtractFaction,
  MapDetails,
  MapSpawn,
  SpawnKind,
} from "@/app/lib/types/raidPlanner";
import { gqlFetch } from "@/app/lib/api/transport";
import { ensureQuery, type QueryDefinition } from "@/app/lib/api/queryClient";
import { MAP_DETAILS } from "./raidPlannerQueries";

/**
 * Same lazy-cache envelope pattern as the gun builder: versioned so schema
 * changes self-invalidate, TTL'd so wipe/patch position changes surface within
 * a day.
 */
interface RawPosition {
  x: number;
  y: number;
  z: number;
}

interface RawMap {
  normalizedName: string;
  players?: string | null;
  raidDuration?: number | null;
  extracts?: {
    id: string;
    name?: string | null;
    faction?: string | null;
    position?: RawPosition | null;
    outline?: { x: number; z: number }[] | null;
    top?: number | null;
    bottom?: number | null;
  }[];
  transits?: {
    id: string;
    description?: string | null;
    position?: RawPosition | null;
  }[];
  spawns?: {
    zoneName?: string | null;
    position?: RawPosition | null;
    sides?: string[] | null;
    categories?: string[] | null;
  }[];
  locks?: {
    lockType?: string | null;
    needsPower?: boolean | null;
    position?: RawPosition | null;
    key?: { name?: string | null } | null;
  }[];
  hazards?: {
    name?: string | null;
    position?: RawPosition | null;
    outline?: { x: number; z: number }[] | null;
    top?: number | null;
    bottom?: number | null;
  }[];
  lootContainers?: {
    position?: RawPosition | null;
    lootContainer?: { normalizedName: string; name?: string | null } | null;
  }[];
  switches?: {
    id: string;
    name?: string | null;
    position?: RawPosition | null;
  }[];
  stationaryWeapons?: {
    position?: RawPosition | null;
    stationaryWeapon?: { name?: string | null } | null;
  }[];
}

const EXTRACT_FACTIONS: ExtractFaction[] = ["pmc", "scav", "shared"];

/**
 * Collapse the API's sides/categories combinations into one planning-relevant
 * bucket per spawn. Categories seen upstream: player, bot, all, botpmc, boss,
 * sniper, none.
 */
function spawnKind(
  sides: string[] | null | undefined,
  categories: string[] | null | undefined
): SpawnKind | null {
  const cats = categories ?? [];
  if (cats.includes("boss")) return "boss";
  if (cats.includes("sniper")) return "sniper";
  if (cats.includes("player") && (sides ?? []).some((s) => s === "pmc" || s === "all")) {
    return "pmc";
  }
  if (cats.includes("botpmc")) return "raider";
  if (cats.includes("bot") || cats.includes("all")) return "scav";
  return null;
}

function normalizeMap(key: string, raw: RawMap): MapDetails {
  const spawns: MapSpawn[] = [];
  for (const spawn of raw.spawns ?? []) {
    if (!spawn.position) continue;
    const kind = spawnKind(spawn.sides, spawn.categories);
    if (!kind) continue;
    spawns.push({
      zoneName: spawn.zoneName ?? null,
      kind,
      position: spawn.position,
    });
  }

  return {
    key,
    players: raw.players ?? null,
    raidDuration: raw.raidDuration ?? null,
    extracts: (raw.extracts ?? [])
      .filter((e) => e.position)
      .map((e) => ({
        id: e.id,
        name: e.name ?? "Extract",
        faction: EXTRACT_FACTIONS.includes(e.faction as ExtractFaction)
          ? (e.faction as ExtractFaction)
          : "shared",
        position: e.position as RawPosition,
        outline: e.outline ?? [],
        top: e.top ?? null,
        bottom: e.bottom ?? null,
      })),
    transits: (raw.transits ?? [])
      .filter((t) => t.position)
      .map((t) => ({
        id: t.id,
        description: t.description ?? "Transit",
        position: t.position as RawPosition,
      })),
    spawns,
    locks: (raw.locks ?? [])
      .filter((l) => l.position)
      .map((l) => ({
        lockType: l.lockType ?? "door",
        needsPower: Boolean(l.needsPower),
        position: l.position as RawPosition,
        keyName: l.key?.name ?? null,
      })),
    hazards: (raw.hazards ?? [])
      .filter((h) => h.position)
      .map((h) => ({
        name: h.name ?? "Hazard",
        position: h.position as RawPosition,
        outline: h.outline ?? [],
        top: h.top ?? null,
        bottom: h.bottom ?? null,
      })),
    lootContainers: (raw.lootContainers ?? [])
      .filter((c) => c.position && c.lootContainer)
      .map((c) => ({
        typeId: c.lootContainer!.normalizedName,
        typeName: c.lootContainer!.name ?? c.lootContainer!.normalizedName,
        position: c.position as RawPosition,
      })),
    switches: (raw.switches ?? [])
      .filter((s) => s.position)
      .map((s) => ({
        id: s.id,
        name: s.name ?? null,
        position: s.position as RawPosition,
      })),
    stationaryWeapons: (raw.stationaryWeapons ?? [])
      .filter((w) => w.position)
      .map((w) => ({
        name: w.stationaryWeapon?.name ?? "Stationary weapon",
        position: w.position as RawPosition,
      })),
  };
}

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
  version: 2,
  staleTime: 1000 * 60 * 60,
  maxAge: 1000 * 60 * 60 * 24 * 7,
  persist: true,
  validate: (value): value is MapDetails | null =>
    value === null ||
    (Boolean(value) &&
      typeof value === "object" &&
      typeof (value as MapDetails).key === "string" &&
      Array.isArray((value as MapDetails).extracts)),
  fetch: async ({ mapKey, mapName, gameMode }, signal) => {
    const data = await gqlFetch<{ maps: RawMap[] }>(
      MAP_DETAILS,
      { gameMode, name: [mapName] },
      { operationName: "MapDetails", signal }
    );

    const raw = (data.maps ?? []).find((map) => map.normalizedName === mapKey);
    return raw ? normalizeMap(mapKey, raw) : null;
  },
};
