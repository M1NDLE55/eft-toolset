import type { GameMode } from "@/components/game-mode/context";
import type {
  BuildItemData,
  BuildNode,
  GunItem,
  GunListItem,
  PickItemData,
  PresetContents,
} from "@/app/lib/types/gunBuilder";
import { cacheDeleteMany, cacheGetMany, cacheKeys, cacheSetMany } from "./store";
import { apiFetch } from "@/app/lib/api/transport";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import { ensureQuery, type QueryDefinition } from "@/app/lib/api/queryClient";
import { reconstructPresetTree } from "@/app/lib/builds/presets";
import { isDetailed } from "@/app/lib/builds/stats";

const GUN_CACHE_VERSION = 3;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const FRESH_MS = 15 * MINUTE;
const MAX_AGE_MS = DAY;
const ID_BATCH_SIZE = 100;
const BATCH_CONCURRENCY = 2;
const MAX_LAZY_IDS = 1_000;
const SWEEP_INTERVAL_MS = 60 * MINUTE;
const LEGACY_PREFIXES = ["guns:", "preset:"];
const ITEM_PREFIXES = { full: "build-item", basic: "pick-item" } as const;

type Detail = keyof typeof ITEM_PREFIXES;

interface CacheEnvelope<T> {
  v: number;
  t: number;
  data: T;
}

export interface GunItemState {
  items: ReadonlyMap<string, GunItem>;
  pending: ReadonlySet<string>;
  missing: ReadonlySet<string>;
  error: Error | null;
}

interface ModeVariables {
  gameMode: GameMode;
}

export const gunListQuery: QueryDefinition<ModeVariables, GunListItem[]> = {
  id: "gun-list",
  version: 1,
  staleTime: DAY,
  maxAge: 30 * DAY,
  persist: true,
  validate: isGunList,
  fetch: async ({ gameMode }, signal) => {
    const guns = await apiFetch<unknown>(TARKOV_OPERATIONS.gunList, { gameMode }, { signal });
    if (!isGunList(guns)) throw new Error("The weapon list response was invalid.");
    return guns.toSorted((a, b) => a.name.localeCompare(b.name));
  },
};

export const presetQuery: QueryDefinition<ModeVariables & { id: string }, PresetContents | null> = {
  id: "gun-preset",
  version: 1,
  staleTime: DAY,
  maxAge: 30 * DAY,
  persist: true,
  validate: isPreset,
  fetch: async ({ gameMode, id }, signal) => {
    const preset = await apiFetch<unknown>(TARKOV_OPERATIONS.preset, { id, gameMode }, { signal });
    if (!isPreset(preset)) throw new Error("The preset response was invalid.");
    return preset;
  },
};

const EMPTY_STATE: GunItemState = Object.freeze({
  items: new Map(),
  pending: new Set<string>(),
  missing: new Set<string>(),
  error: null,
});
const states = new Map<GameMode, GunItemState>();
const fetchedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let lastSweepAt = 0;

export function subscribeGunItems(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGunItemState(gameMode: GameMode): GunItemState {
  return states.get(gameMode) ?? EMPTY_STATE;
}

function update(gameMode: GameMode, change: (state: GunItemState) => Partial<GunItemState>) {
  const current = getGunItemState(gameMode);
  states.set(gameMode, { ...current, ...change(current) });
  for (const listener of listeners) listener();
}

function merge(gameMode: GameMode, detail: Detail, entries: { item: GunItem; t: number }[]) {
  if (entries.length === 0) return;
  update(gameMode, (state) => {
    const items = new Map(state.items);
    for (const { item, t } of entries) {
      if ((fetchedAt.get(stampKey(gameMode, detail, item.id)) ?? 0) > t) continue;
      const existing = items.get(item.id);
      if (detail === "basic" && isDetailed(existing)) {
        items.set(item.id, { ...existing, ...item });
      } else {
        items.set(item.id, item);
      }
      fetchedAt.set(stampKey(gameMode, detail, item.id), t);
      if (detail === "full") fetchedAt.set(stampKey(gameMode, "basic", item.id), t);
    }
    return { items };
  });
}

function stampKey(gameMode: GameMode, detail: Detail, id: string) {
  return `${detail}:${gameMode}:${id}`;
}

function isFresh(gameMode: GameMode, detail: Detail, id: string) {
  const state = getGunItemState(gameMode);
  const item = state.items.get(id);
  const known = state.missing.has(id) || (item && (detail === "basic" || isDetailed(item)));
  return Boolean(known) && Date.now() - (fetchedAt.get(stampKey(gameMode, detail, id)) ?? 0) < FRESH_MS;
}

export async function ensureGunItems(
  ids: readonly string[],
  gameMode: GameMode,
  detail: Detail
): Promise<void> {
  sweepPersistentCache();
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (unique.length > MAX_LAZY_IDS) {
    throw new Error(`A build can load at most ${MAX_LAZY_IDS} unique items.`);
  }
  const waits: Promise<void>[] = [];
  const missing: string[] = [];
  for (const id of unique) {
    if (isFresh(gameMode, detail, id)) continue;
    const active =
      inFlight.get(stampKey(gameMode, "full", id)) ??
      (detail === "basic" ? inFlight.get(stampKey(gameMode, "basic", id)) : undefined);
    if (active) waits.push(active);
    else missing.push(id);
  }
  if (missing.length > 0) {
    const task = loadItems(missing, gameMode, detail);
    for (const id of missing) inFlight.set(stampKey(gameMode, detail, id), task);
    waits.push(task);
  }
  await Promise.all(waits);
}

async function loadItems(ids: string[], gameMode: GameMode, detail: Detail) {
  update(gameMode, (state) => ({ pending: new Set([...state.pending, ...ids]) }));
  try {
    const remaining = await readPersisted(ids, gameMode, detail);
    const fetched: GunItem[] = [];
    const batches = chunk(remaining, ID_BATCH_SIZE);
    for (let index = 0; index < batches.length; index += BATCH_CONCURRENCY) {
      const responses = await Promise.all(
        batches.slice(index, index + BATCH_CONCURRENCY).map((batch) =>
          apiFetch<unknown>(
            detail === "full" ? TARKOV_OPERATIONS.buildItems : TARKOV_OPERATIONS.pickItems,
            { ids: batch, gameMode }
          )
        )
      );
      for (const response of responses) {
        const validate = detail === "full" ? isBuildItem : isPickItem;
        if (!Array.isArray(response) || !response.every(validate)) {
          throw new Error("The item-detail response was invalid.");
        }
        fetched.push(...response);
      }
    }
    const now = Date.now();
    merge(gameMode, detail, fetched.map((item) => ({ item, t: now })));
    const found = new Set(fetched.map((item) => item.id));
    update(gameMode, (state) => {
      const missing = new Set(state.missing);
      for (const id of remaining) {
        if (found.has(id)) missing.delete(id);
        else if (!state.items.has(id)) {
          missing.add(id);
          fetchedAt.set(stampKey(gameMode, detail, id), now);
        }
      }
      return { missing, error: null };
    });
    if (fetched.length > 0) {
      void cacheSetMany(
        fetched.map((item) => [
          `${ITEM_PREFIXES[detail]}:${gameMode}:${item.id}`,
          { v: GUN_CACHE_VERSION, t: now, data: item },
        ])
      ).catch(() => undefined);
    }
  } catch (reason) {
    update(gameMode, () => ({
      error: reason instanceof Error ? reason : new Error("Could not load item data."),
    }));
    throw reason;
  } finally {
    for (const id of ids) {
      const key = stampKey(gameMode, detail, id);
      inFlight.delete(key);
    }
    update(gameMode, (state) => {
      const pending = new Set(state.pending);
      for (const id of ids) pending.delete(id);
      return { pending };
    });
  }
}

async function readPersisted(ids: string[], gameMode: GameMode, detail: Detail) {
  const keys = ids.map((id) => `${ITEM_PREFIXES[detail]}:${gameMode}:${id}`);
  let entries: (CacheEnvelope<unknown> | undefined)[];
  try {
    entries = await cacheGetMany<CacheEnvelope<unknown>>(keys);
  } catch {
    return ids;
  }
  const validate = detail === "full" ? isBuildItem : isPickItem;
  const now = Date.now();
  const usable: { item: GunItem; t: number }[] = [];
  const obsolete: string[] = [];
  const remaining: string[] = [];
  entries.forEach((entry, index) => {
    const valid =
      entry &&
      entry.v === GUN_CACHE_VERSION &&
      typeof entry.t === "number" &&
      now - entry.t < MAX_AGE_MS &&
      validate(entry.data) &&
      entry.data.id === ids[index];
    if (!valid) {
      if (entry) obsolete.push(keys[index]);
      remaining.push(ids[index]);
      return;
    }
    usable.push({ item: entry.data as GunItem, t: entry.t });
    if (now - entry.t >= FRESH_MS) remaining.push(ids[index]);
  });
  merge(gameMode, detail, usable);
  if (obsolete.length > 0) void cacheDeleteMany(obsolete).catch(() => undefined);
  return remaining;
}

export function detailedItems(gameMode: GameMode) {
  const result = new Map<string, BuildItemData>();
  for (const [id, item] of getGunItemState(gameMode).items) {
    if (isDetailed(item)) result.set(id, item);
  }
  return result;
}

export async function loadPresetTree(
  presetId: string,
  weaponId: string,
  gameMode: GameMode
): Promise<BuildNode | null> {
  const [preset] = await Promise.all([
    ensureQuery(presetQuery, { gameMode, id: presetId }),
    ensureGunItems([weaponId], gameMode, "full"),
  ]);
  if (!preset || (preset.baseItemId !== null && preset.baseItemId !== weaponId)) return null;
  await ensureGunItems([weaponId, ...preset.itemIds], gameMode, "full");
  return reconstructPresetTree(weaponId, preset, detailedItems(gameMode));
}

export function prefetchGunList(gameMode: GameMode) {
  void ensureQuery(gunListQuery, { gameMode }).catch(() => undefined);
}

export function prefetchPreset(presetId: string, weaponId: string, gameMode: GameMode) {
  void loadPresetTree(presetId, weaponId, gameMode).catch(() => undefined);
}

export function prefetchBuildItems(ids: readonly string[], gameMode: GameMode) {
  void ensureGunItems(ids, gameMode, "full").catch(() => undefined);
}

export function prefetchSlotItems(ids: readonly string[], gameMode: GameMode) {
  void ensureGunItems(ids, gameMode, "basic").catch(() => undefined);
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

function sweepPersistentCache() {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  void (async () => {
    const prefixes = Object.values(ITEM_PREFIXES).map((prefix) => `${prefix}:`);
    const keys = (await cacheKeys()).filter(
      (key): key is string =>
        typeof key === "string" &&
        [...prefixes, ...LEGACY_PREFIXES].some((prefix) => key.startsWith(prefix))
    );
    const entries = await cacheGetMany<CacheEnvelope<unknown>>(keys);
    const obsolete = keys.filter((key, index) => {
      const entry = entries[index];
      return (
        LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
        !entry ||
        entry.v !== GUN_CACHE_VERSION ||
        typeof entry.t !== "number" ||
        now - entry.t > MAX_AGE_MS
      );
    });
    if (obsolete.length > 0) await cacheDeleteMany(obsolete);
  })().catch(() => undefined);
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
