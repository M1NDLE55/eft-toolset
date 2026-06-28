import type { GameMode } from "@/components/game-mode/context";
import type {
  BuildItemData,
  GunListItem,
  ModSlotDef,
  PickItemData,
  PresetContents,
} from "@/app/lib/types/gunBuilder";
import { cacheGet, cacheSet } from "./store";
import { gqlFetch } from "./fetcher";
import {
  BUILD_ITEMS,
  GUN_LIST,
  PICK_ITEMS,
  PRESET_DETAIL,
} from "./gunBuilderQueries";

/**
 * Gun-builder data lives in the same idb store as the bulk cache but is fetched
 * lazily and never goes through the bulk `meta` version gate. Wrap every entry
 * in a small envelope so it self-invalidates on schema changes (bump the
 * version) or after a wipe/patch (TTL). buyFor here is trader pricing, which is
 * stable within a wipe, so a 24h TTL is comfortably conservative.
 */
const GUN_CACHE_VERSION = 2;
const GUN_CACHE_TTL = 1000 * 60 * 60 * 24;

const FLEA_VENDOR = "Flea Market";

interface CacheEnvelope<T> {
  v: number;
  t: number;
  data: T;
}

async function readCache<T>(key: string): Promise<T | undefined> {
  const entry = await cacheGet<CacheEnvelope<T>>(key);
  if (!entry || typeof entry !== "object" || entry.v !== GUN_CACHE_VERSION) {
    return undefined;
  }
  if (Date.now() - entry.t > GUN_CACHE_TTL) return undefined;
  return entry.data;
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  await cacheSet<CacheEnvelope<T>>(key, {
    v: GUN_CACHE_VERSION,
    t: Date.now(),
    data,
  });
}

interface RawBuyFor {
  priceRUB?: number | null;
  vendor?: { name?: string | null } | null;
}

interface RawSlot {
  id: string;
  name: string;
  nameId: string;
  required: boolean;
  filters?: { allowedItems?: { id: string }[] | null } | null;
}

interface RawBuildItem {
  id: string;
  name: string;
  shortName?: string | null;
  gridImageLink?: string | null;
  weight?: number | null;
  buyFor?: RawBuyFor[] | null;
  conflictingItems?: { id: string }[] | null;
  conflictingSlotIds?: string[] | null;
  properties?: {
    __typename?: string;
    caliber?: string | null;
    ergonomics?: number | null;
    recoilModifier?: number | null;
    recoilVertical?: number | null;
    recoilHorizontal?: number | null;
    fireRate?: number | null;
    fireModes?: string[] | null;
    defaultAmmo?: { name: string } | null;
    defaultPreset?: { id: string } | null;
    presets?: { id: string; name: string }[] | null;
    slots?: RawSlot[] | null;
  } | null;
}

interface RawGunListItem {
  id: string;
  name: string;
  shortName?: string | null;
  gridImageLink?: string | null;
  properties?: {
    defaultPreset?: { id: string } | null;
  } | null;
}

/**
 * Splits `buyFor` offers into the cheapest trader price and the flea price.
 * tarkov.dev returns flea as a vendor named "Flea Market" inside `buyFor`;
 * everything else is a trader.
 */
function splitPrices(buyFor?: RawBuyFor[] | null): {
  trader: number | null;
  flea: number | null;
} {
  let trader: number | null = null;
  let flea: number | null = null;

  for (const offer of buyFor ?? []) {
    if (typeof offer.priceRUB !== "number") continue;
    if (offer.vendor?.name === FLEA_VENDOR) {
      flea = flea === null ? offer.priceRUB : Math.min(flea, offer.priceRUB);
    } else {
      trader =
        trader === null ? offer.priceRUB : Math.min(trader, offer.priceRUB);
    }
  }

  return { trader, flea };
}

function normalizeSlots(slots?: RawSlot[] | null): ModSlotDef[] {
  return (slots ?? []).map((slot) => ({
    id: slot.id,
    name: slot.name,
    nameId: slot.nameId,
    required: Boolean(slot.required),
    allowedItemIds: slot.filters?.allowedItems?.map((item) => item.id) ?? [],
  }));
}

function normalizeBuildItem(item: RawBuildItem): BuildItemData {
  const properties = item.properties;
  const isWeapon = properties?.__typename === "ItemPropertiesWeapon";
  const prices = splitPrices(item.buyFor);

  return {
    id: item.id,
    name: item.name,
    shortName: item.shortName ?? item.name,
    gridImageLink: item.gridImageLink ?? null,
    weight: item.weight ?? 0,
    traderPriceRUB: prices.trader,
    fleaPriceRUB: prices.flea,
    ergonomics: properties?.ergonomics ?? 0,
    recoilModifier: isWeapon ? 0 : properties?.recoilModifier ?? 0,
    recoilVertical: isWeapon ? properties?.recoilVertical ?? null : null,
    recoilHorizontal: isWeapon ? properties?.recoilHorizontal ?? null : null,
    isWeapon,
    caliber: properties?.caliber ?? null,
    fireRate: properties?.fireRate ?? null,
    fireModes: properties?.fireModes ?? [],
    defaultAmmoName: properties?.defaultAmmo?.name ?? null,
    defaultPresetId: properties?.defaultPreset?.id ?? null,
    presets: properties?.presets ?? [],
    conflictingItemIds:
      item.conflictingItems?.map((conflict) => conflict.id) ?? [],
    conflictingSlotIds: item.conflictingSlotIds ?? [],
    slots: normalizeSlots(properties?.slots),
  };
}

function normalizePickItem(item: RawBuildItem): PickItemData {
  const prices = splitPrices(item.buyFor);
  return {
    id: item.id,
    name: item.name,
    shortName: item.shortName ?? item.name,
    gridImageLink: item.gridImageLink ?? null,
    weight: item.weight ?? 0,
    traderPriceRUB: prices.trader,
    fleaPriceRUB: prices.flea,
    ergonomics: item.properties?.ergonomics ?? 0,
    recoilModifier: item.properties?.recoilModifier ?? 0,
    conflictingItemIds:
      item.conflictingItems?.map((conflict) => conflict.id) ?? [],
    conflictingSlotIds: item.conflictingSlotIds ?? [],
  };
}

export async function fetchGunList(gameMode: GameMode): Promise<GunListItem[]> {
  const cacheKey = `guns:${gameMode}`;
  const cached = await readCache<GunListItem[]>(cacheKey);
  if (cached) return cached;

  const data = await gqlFetch<{ items: RawGunListItem[] }>(GUN_LIST, {
    gameMode,
  });

  const guns = (data.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    shortName: item.shortName ?? item.name,
    gridImageLink: item.gridImageLink ?? null,
    defaultPresetId: item.properties?.defaultPreset?.id ?? null,
  }));

  await writeCache(cacheKey, guns);
  return guns;
}

/**
 * Generic batched lazy-loader for per-id detail. Reads each id from idb, issues
 * one GraphQL call for the misses, normalizes, and writes each back.
 */
async function fetchCachedById<T extends { id: string }>(
  ids: string[],
  query: string,
  gameMode: GameMode,
  keyPrefix: string,
  normalize: (raw: RawBuildItem) => T
): Promise<T[]> {
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (uniqueIds.length === 0) return [];

  const cachedEntries = (await Promise.all(
    uniqueIds.map((id) => readCache<T>(`${keyPrefix}:${gameMode}:${id}`))
  )) as (T | undefined)[];
  const cached = cachedEntries.filter((item): item is T => Boolean(item));
  const missingIds = uniqueIds.filter((_, index) => !cachedEntries[index]);

  if (missingIds.length === 0) return cached;

  const data = await gqlFetch<{ items: RawBuildItem[] }>(query, {
    ids: missingIds,
    gameMode,
  });

  const fetched = (data.items ?? []).map(normalize);
  await Promise.all(
    fetched.map((item) => writeCache(`${keyPrefix}:${gameMode}:${item.id}`, item))
  );

  return [...cached, ...fetched];
}

export function fetchBuildItems(
  ids: string[],
  gameMode: GameMode
): Promise<BuildItemData[]> {
  return fetchCachedById(
    ids,
    BUILD_ITEMS,
    gameMode,
    "build-item",
    normalizeBuildItem
  );
}

export function fetchPickItems(
  ids: string[],
  gameMode: GameMode
): Promise<PickItemData[]> {
  return fetchCachedById(
    ids,
    PICK_ITEMS,
    gameMode,
    "pick-item",
    normalizePickItem
  );
}

export async function fetchPreset(
  id: string,
  gameMode: GameMode
): Promise<PresetContents | null> {
  const data = await gqlFetch<{
    items: {
      properties?: { baseItem?: { id: string } | null } | null;
      containsItems?: { item?: { id: string } | null }[] | null;
    }[];
  }>(PRESET_DETAIL, { id, gameMode });

  const preset = data.items?.[0];
  if (!preset) return null;

  return {
    baseItemId: preset.properties?.baseItem?.id ?? null,
    itemIds:
      preset.containsItems
        ?.map((entry) => entry.item?.id)
        .filter((itemId): itemId is string => Boolean(itemId)) ?? [],
  };
}
