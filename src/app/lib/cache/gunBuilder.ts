import type { GameMode } from "@/components/game-mode/context";
import type {
  BuildItemData,
  GunListItem,
  PickItemData,
  PresetContents,
} from "@/app/lib/types/gunBuilder";
import { cacheDelete, cacheDeleteMany, cacheGet, cacheGetMany, cacheKeys, cacheSet, cacheSetMany } from "./store";
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
const MAX_LAZY_IDS = 1_000;
const GUN_CACHE_SWEEP_INTERVAL_MS = 60 * 60_000;
let lastGunCacheSweepAt = 0;
let gunCacheSweep: Promise<void> | null = null;

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
    await cacheDelete(key).catch(() => undefined);
    return undefined;
  }
  if (Date.now() - entry.t > ttl) {
    await cacheDelete(key).catch(() => undefined);
    return undefined;
  }
  return entry.data;
}

async function readCacheMany<T>(keys: string[], ttl = PRICE_CACHE_TTL) {
  let entries: (CacheEnvelope<T> | undefined)[];
  try {
    entries = await cacheGetMany<CacheEnvelope<T>>(keys);
  } catch {
    return keys.map(() => undefined);
  }
  const expiredKeys: string[] = [];
  const values = entries.map((entry, index) => {
    if (!entry || entry.v !== GUN_CACHE_VERSION || Date.now() - entry.t > ttl) {
      if (entry) expiredKeys.push(keys[index]);
      return undefined;
    }
    return entry.data;
  });
  if (expiredKeys.length > 0) void cacheDeleteMany(expiredKeys).catch(() => undefined);
  return values;
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
  startGunCacheSweep();
  const cacheKey = `guns:${gameMode}`;
  const cached = await readCache<GunListItem[]>(cacheKey, STRUCTURE_CACHE_TTL);
  if (cached && isGunList(cached)) return cached;
  if (cached) await cacheDelete(cacheKey).catch(() => undefined);

  const guns = await apiFetch<GunListItem[]>(TARKOV_OPERATIONS.gunList, { gameMode });
  if (!isGunList(guns)) throw new Error("The weapon list response was invalid.");

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
  keyPrefix: string,
  validate: (value: unknown) => value is T
): Promise<T[]> {
  startGunCacheSweep();
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (uniqueIds.length === 0) return [];
  if (uniqueIds.length > MAX_LAZY_IDS) {
    throw new Error(`A build can load at most ${MAX_LAZY_IDS} unique items.`);
  }

  const cacheKeys = uniqueIds.map((id) => `${keyPrefix}:${gameMode}:${id}`);
  const rawCachedEntries = await readCacheMany<T>(cacheKeys);
  const invalidCacheKeys: string[] = [];
  const cachedEntries = rawCachedEntries.map((entry, index) => {
    if (entry === undefined || validate(entry)) return entry;
    invalidCacheKeys.push(cacheKeys[index]);
    return undefined;
  });
  if (invalidCacheKeys.length > 0) void cacheDeleteMany(invalidCacheKeys).catch(() => undefined);
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
      if (!Array.isArray(response) || !response.every(validate)) {
        throw new Error("The item-detail response was invalid.");
      }
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
    "build-item",
    isBuildItem
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
    "pick-item",
    isPickItem
  );
}

export async function fetchPreset(
  id: string,
  gameMode: GameMode
): Promise<PresetContents | null> {
  startGunCacheSweep();
  const cacheKey = `preset:${gameMode}:${id}`;
  const cached = await readCache<PresetContents | null>(cacheKey, STRUCTURE_CACHE_TTL);
  if (cached !== undefined && isPreset(cached)) return cached;
  if (cached !== undefined) await cacheDelete(cacheKey).catch(() => undefined);

  const result = await apiFetch<PresetContents | null>(
    TARKOV_OPERATIONS.preset,
    { id, gameMode }
  );
  if (!isPreset(result)) throw new Error("The preset response was invalid.");
  await writeCache(cacheKey, result);
  return result;
}

function isGunList(value: unknown): value is GunListItem[] {
  return Array.isArray(value) && value.length <= 10_000 && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const gun = item as Partial<GunListItem>;
    return (
      validString(gun.id, 160, true) &&
      validString(gun.name, 500, true) &&
      validString(gun.shortName, 500, true) &&
      validAssetUrl(gun.gridImageLink) &&
      (gun.defaultPresetId === null || validString(gun.defaultPresetId, 160, true))
    );
  });
}

function isBuildItem(value: unknown): value is BuildItemData {
  if (!isPickItem(value)) return false;
  const item = value as Partial<BuildItemData>;
  return (
    typeof item.isWeapon === "boolean" &&
    nullableFinite(item.recoilVertical) &&
    nullableFinite(item.recoilHorizontal) &&
    (item.caliber === undefined || item.caliber === null || validString(item.caliber, 500)) &&
    (item.fireRate === undefined || nullableFinite(item.fireRate)) &&
    (item.fireModes === undefined || validStringArray(item.fireModes, 100)) &&
    (item.defaultAmmoName === undefined || item.defaultAmmoName === null || validString(item.defaultAmmoName, 500)) &&
    (item.defaultPresetId === undefined || item.defaultPresetId === null || validString(item.defaultPresetId, 160, true)) &&
    (item.presets === undefined ||
      (Array.isArray(item.presets) && item.presets.length <= 1_000 && item.presets.every(
        (preset) => validString(preset?.id, 160, true) && validString(preset?.name, 500, true)
      ))) &&
    Array.isArray(item.slots) && item.slots.length <= 64 && item.slots.every((slot) =>
      validString(slot?.id, 160, true) &&
      validString(slot?.name, 500, true) &&
      validString(slot?.nameId, 160, true) &&
      typeof slot?.required === "boolean" &&
      validStringArray(slot?.allowedItemIds, 20_000)
    )
  );
}

function isPickItem(value: unknown): value is PickItemData {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PickItemData>;
  return (
    validString(item.id, 160, true) &&
    validString(item.name, 500, true) &&
    validString(item.shortName, 500, true) &&
    validAssetUrl(item.gridImageLink) &&
    finite(item.weight) &&
    nullableFinite(item.traderPriceRUB) &&
    nullableFinite(item.fleaPriceRUB) &&
    finite(item.ergonomics) &&
    finite(item.recoilModifier) &&
    validStringArray(item.conflictingItemIds, 20_000) &&
    validStringArray(item.conflictingSlotIds, 20_000)
  );
}

function isPreset(value: unknown): value is PresetContents | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const preset = value as Partial<PresetContents>;
  return (
    (preset.baseItemId === null || validString(preset.baseItemId, 160, true)) &&
    validStringArray(preset.itemIds, MAX_LAZY_IDS)
  );
}

function validString(value: unknown, max: number, required = false): value is string {
  return typeof value === "string" && value.length <= max && (!required || value.length > 0);
}

function validStringArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((entry) => validString(entry, 500, true));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullableFinite(value: unknown): value is number | null {
  return value === null || finite(value);
}

function validAssetUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "assets.tarkov.dev" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function startGunCacheSweep() {
  const now = Date.now();
  if (gunCacheSweep || now - lastGunCacheSweepAt < GUN_CACHE_SWEEP_INTERVAL_MS) return;
  lastGunCacheSweepAt = now;
  gunCacheSweep = (async () => {
    try {
      const prefixes = ["guns:", "build-item:", "pick-item:", "preset:"];
      const keys = (await cacheKeys()).filter(
        (key): key is string =>
          typeof key === "string" && prefixes.some((prefix) => key.startsWith(prefix))
      );
      const entries = await cacheGetMany<CacheEnvelope<unknown>>(keys);
      const obsolete = keys.filter((_, index) => {
        const entry = entries[index];
        return (
          !entry ||
          entry.v !== GUN_CACHE_VERSION ||
          typeof entry.t !== "number" ||
          Date.now() - entry.t > STRUCTURE_CACHE_TTL
        );
      });
      if (obsolete.length > 0) await cacheDeleteMany(obsolete);
    } catch {
      // IndexedDB cleanup is best-effort.
    }
  })().finally(() => {
    gunCacheSweep = null;
  });
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
