import type { GameMode } from "@/components/game-mode/context";
import type {
  ExtractFaction,
  MapBoss,
  MapDetails,
  MapSpawn,
  SpawnKind,
} from "@/app/lib/types/raidPlanner";
import { cacheGet, cacheSet } from "./store";
import { gqlFetch } from "./fetcher";
import { MAP_DETAILS } from "./raidPlannerQueries";

/**
 * Same lazy-cache envelope pattern as the gun builder: versioned so schema
 * changes self-invalidate, TTL'd so wipe/patch position changes surface within
 * a day.
 */
const MAP_CACHE_VERSION = 1;
const MAP_CACHE_TTL = 1000 * 60 * 60 * 24;

interface CacheEnvelope<T> {
  v: number;
  t: number;
  data: T;
}

async function readCache<T>(key: string): Promise<T | undefined> {
  const entry = await cacheGet<CacheEnvelope<T>>(key);
  if (!entry || typeof entry !== "object" || entry.v !== MAP_CACHE_VERSION) {
    return undefined;
  }
  if (Date.now() - entry.t > MAP_CACHE_TTL) return undefined;
  return entry.data;
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  await cacheSet<CacheEnvelope<T>>(key, {
    v: MAP_CACHE_VERSION,
    t: Date.now(),
    data,
  });
}

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
    key?: { id: string; name?: string | null } | null;
  }[];
  hazards?: {
    hazardType?: string | null;
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
  bosses?: {
    boss?: { name?: string | null } | null;
    spawnChance?: number | null;
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

/** De-duplicate bosses that appear once per spawn zone (e.g. Factory USEC×2). */
function normalizeBosses(raw: RawMap["bosses"]): MapBoss[] {
  const byName = new Map<string, number>();
  for (const entry of raw ?? []) {
    const name = entry.boss?.name;
    if (!name) continue;
    byName.set(name, Math.max(byName.get(name) ?? 0, entry.spawnChance ?? 0));
  }
  return Array.from(byName, ([name, spawnChance]) => ({ name, spawnChance }));
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
        keyId: l.key?.id ?? null,
        keyName: l.key?.name ?? null,
      })),
    hazards: (raw.hazards ?? [])
      .filter((h) => h.position)
      .map((h) => ({
        hazardType: h.hazardType ?? "hazard",
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
    bosses: normalizeBosses(raw.bosses),
  };
}

export async function fetchMapDetails(
  mapKey: string,
  gameMode: GameMode
): Promise<MapDetails | null> {
  const cacheKey = `map-details:${gameMode}:${mapKey}`;
  const cached = await readCache<MapDetails>(cacheKey);
  if (cached) return cached;

  const data = await gqlFetch<{ maps: RawMap[] }>(MAP_DETAILS, {
    gameMode,
    name: [mapKey],
  });

  const raw = (data.maps ?? []).find((m) => m.normalizedName === mapKey);
  if (!raw) return null;

  const details = normalizeMap(mapKey, raw);
  await writeCache(cacheKey, details);
  return details;
}
