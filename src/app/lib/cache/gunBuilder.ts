import type { GameMode } from "@/components/game-mode/context";
import type {
  BuildItemData,
  GunListItem,
  PickItemData,
  PresetContents,
} from "@/app/lib/types/gunBuilder";
import { cacheGet, cacheGetMany, cacheSet, cacheSetMany } from "./store";
import { apiFetch } from "@/app/lib/api/transport";
import { TARKOV_OPERATIONS, type TarkovOperation } from "@/app/lib/api/operations";

/**
 * Gun-builder data lives in the same idb store as the bulk cache but is fetched
 * lazily and never goes through the bulk `meta` version gate. Wrap every entry
 * in a small envelope so it self-invalidates on schema changes (bump the
 * version) or after a wipe/patch (TTL). Volatile trader/flea projections expire
 * after 15 minutes while weapon structure and presets expire after 24 hours.
 */
const GUN_CACHE_VERSION = 3;
const PRICE_CACHE_TTL = 1000 * 60 * 15;
const STRUCTURE_CACHE_TTL = 1000 * 60 * 60 * 24;
const ID_BATCH_SIZE = 100;
const BATCH_CONCURRENCY = 2;

interface CacheEnvelope<T> {
  v: number;
  t: number;
  data: T;
}

async function readCache<T>(key: string, ttl = PRICE_CACHE_TTL): Promise<T | undefined> {
  let entry: CacheEnvelope<T> | undefined;
  try {
    entry = await cacheGet<CacheEnvelope<T>>(key);
  } catch {
    return undefined;
  }
  if (!entry || typeof entry !== "object" || entry.v !== GUN_CACHE_VERSION) {
    return undefined;
  }
  if (Date.now() - entry.t > ttl) return undefined;
  return entry.data;
}

async function readCacheMany<T>(keys: string[], ttl = PRICE_CACHE_TTL) {
  let entries: (CacheEnvelope<T> | undefined)[];
  try {
    entries = await cacheGetMany<CacheEnvelope<T>>(keys);
  } catch {
    return keys.map(() => undefined);
  }
  return entries.map((entry) => {
    if (!entry || entry.v !== GUN_CACHE_VERSION || Date.now() - entry.t > ttl) {
      return undefined;
    }
    return entry.data;
  });
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await cacheSet<CacheEnvelope<T>>(key, {
      v: GUN_CACHE_VERSION,
      t: Date.now(),
      data,
    });
  } catch {
    // IndexedDB persistence is optional; return network data normally.
  }
}

export async function fetchGunList(gameMode: GameMode): Promise<GunListItem[]> {
  const cacheKey = `guns:${gameMode}`;
  const cached = await readCache<GunListItem[]>(cacheKey, STRUCTURE_CACHE_TTL);
  if (cached) return cached;

  const guns = await apiFetch<GunListItem[]>(TARKOV_OPERATIONS.gunList, { gameMode });

  await writeCache(cacheKey, guns);
  return guns;
}

/**
 * Generic batched lazy-loader for per-id detail. Reads each id from idb, issues
 * one typed API call for the misses and writes each result back.
 */
async function fetchCachedById<T extends { id: string }>(
  ids: string[],
  operation: TarkovOperation,
  gameMode: GameMode,
  keyPrefix: string
): Promise<T[]> {
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (uniqueIds.length === 0) return [];

  const cacheKeys = uniqueIds.map((id) => `${keyPrefix}:${gameMode}:${id}`);
  const cachedEntries = await readCacheMany<T>(cacheKeys);
  const cached = cachedEntries.filter((item): item is T => Boolean(item));
  const missingIds = uniqueIds.filter((_, index) => !cachedEntries[index]);

  if (missingIds.length === 0) return cached;

  const chunks = chunk(missingIds, ID_BATCH_SIZE);
  const fetched: T[] = [];
  for (let index = 0; index < chunks.length; index += BATCH_CONCURRENCY) {
    const batch = chunks.slice(index, index + BATCH_CONCURRENCY);
    const responses = await Promise.all(
      batch.map((ids) =>
        apiFetch<T[]>(operation, { ids, gameMode })
      )
    );
    for (const response of responses) {
      fetched.push(...response);
    }
  }

  if (fetched.length > 0) {
    try {
      await cacheSetMany(
        fetched.map((item) => [
          `${keyPrefix}:${gameMode}:${item.id}`,
          { v: GUN_CACHE_VERSION, t: Date.now(), data: item },
        ])
      );
    } catch {
      // IndexedDB persistence is optional; return network data normally.
    }
  }

  const byId = new Map([...cached, ...fetched].map((item) => [item.id, item]));
  return uniqueIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export function fetchBuildItems(
  ids: string[],
  gameMode: GameMode
): Promise<BuildItemData[]> {
  return fetchCachedById(
    ids,
    TARKOV_OPERATIONS.buildItems,
    gameMode,
    "build-item"
  );
}

export function fetchPickItems(
  ids: string[],
  gameMode: GameMode
): Promise<PickItemData[]> {
  return fetchCachedById(
    ids,
    TARKOV_OPERATIONS.pickItems,
    gameMode,
    "pick-item"
  );
}

export async function fetchPreset(
  id: string,
  gameMode: GameMode
): Promise<PresetContents | null> {
  const cacheKey = `preset:${gameMode}:${id}`;
  const cached = await readCache<PresetContents | null>(cacheKey, STRUCTURE_CACHE_TTL);
  if (cached !== undefined) return cached;

  const result = await apiFetch<PresetContents | null>(
    TARKOV_OPERATIONS.preset,
    { id, gameMode }
  );
  await writeCache(cacheKey, result);
  return result;
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
