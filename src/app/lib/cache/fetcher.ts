import type { GameMode } from "@/components/game-mode/context";
import { apiFetch } from "@/app/lib/api/transport";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import type { QueryDefinition } from "@/app/lib/api/queryClient";
import type { CachedItem, CatalogItem, ComposedItem } from "./types";
import { MAX_GROUP_ITEMS } from "@/app/lib/item-groups/limits";

const NAME_BATCH_SIZE = 100;
const BATCH_CONCURRENCY = 2;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface ModeVariables {
  gameMode: GameMode;
}

interface GroupVariables extends ModeVariables {
  names: string[];
}

interface DetailVariables extends ModeVariables {
  name: string;
}

export const itemCatalogQuery: QueryDefinition<ModeVariables, CatalogItem[]> = {
  id: "item-catalog",
  version: 2,
  staleTime: DAY,
  maxAge: 30 * DAY,
  persist: true,
  validate: isCatalog,
  fetch: ({ gameMode }, signal) =>
    apiFetch<CatalogItem[]>(TARKOV_OPERATIONS.itemCatalog, { gameMode }, { signal }),
};

export const groupItemsQuery: QueryDefinition<GroupVariables, CachedItem[]> = {
  id: "group-items",
  version: 2,
  staleTime: 10 * MINUTE,
  maxAge: DAY,
  persist: true,
  validate: isCachedItems,
  fetch: async ({ names, gameMode }, signal) => {
    const uniqueNames = Array.from(new Set(names.filter(Boolean))).sort();
    if (uniqueNames.length === 0) return [];
    if (uniqueNames.length > MAX_GROUP_ITEMS) {
      throw new Error(`A group can contain at most ${MAX_GROUP_ITEMS} items.`);
    }
    const batches = chunk(uniqueNames, NAME_BATCH_SIZE);
    const results: CachedItem[] = [];
    for (let index = 0; index < batches.length; index += BATCH_CONCURRENCY) {
      const responses = await Promise.all(
        batches.slice(index, index + BATCH_CONCURRENCY).map((batch) =>
          apiFetch<CachedItem[]>(
            TARKOV_OPERATIONS.groupItems,
            { names: batch, gameMode },
            { signal }
          )
        )
      );
      for (const response of responses) results.push(...response);
    }
    return results;
  },
};

export const itemDetailQuery: QueryDefinition<DetailVariables, ComposedItem | null> = {
  id: "item-detail",
  version: 2,
  staleTime: 5 * MINUTE,
  maxAge: DAY,
  persist: true,
  validate: (value): value is ComposedItem | null => value === null || isComposedItem(value),
  fetch: async ({ name, gameMode }, signal) => {
    if (!name) return null;
    return apiFetch<ComposedItem | null>(
      TARKOV_OPERATIONS.itemDetail,
      { name, gameMode },
      { signal }
    );
  },
};

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function isCatalog(value: unknown): value is CatalogItem[] {
  return Array.isArray(value) && value.length <= 100_000 && value.every(isCatalogItem);
}

function isCatalogItem(value: unknown): value is CatalogItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CatalogItem>;
  return (
    typeof item.id === "string" &&
    typeof item.normalizedName === "string" &&
    typeof item.name === "string" &&
    item.name.length <= 500 &&
    (item.shortName === null || typeof item.shortName === "string") &&
    (item.gridImageLink === null || isSafeAssetUrl(item.gridImageLink))
  );
}

function isCachedItems(value: unknown): value is CachedItem[] {
  return Array.isArray(value) && value.length <= 2_000 && value.every(isCachedItem);
}

function isCachedItem(value: unknown): value is CachedItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CachedItem>;
  return (
    typeof item.id === "string" &&
    item.id.length <= 500 &&
    typeof item.normalizedName === "string" &&
    item.normalizedName.length <= 500 &&
    typeof item.name === "string" &&
    item.name.length <= 500 &&
    (item.shortName === null || typeof item.shortName === "string") &&
    (item.fleaMarketFee === null ||
      (typeof item.fleaMarketFee === "number" && Number.isFinite(item.fleaMarketFee))) &&
    typeof item.width === "number" &&
    Number.isFinite(item.width) &&
    item.width > 0 &&
    typeof item.height === "number" &&
    Number.isFinite(item.height) &&
    item.height > 0 &&
    (item.gridImageLink === null || item.gridImageLink === undefined || isSafeAssetUrl(item.gridImageLink)) &&
    (item.wikiLink === null || item.wikiLink === undefined || isSafeHttpsUrl(item.wikiLink)) &&
    Array.isArray(item.buyFor) &&
    item.buyFor.length <= 1_000 &&
    item.buyFor.every(isVendorPrice) &&
    Array.isArray(item.sellFor) &&
    item.sellFor.length <= 1_000 &&
    item.sellFor.every(isVendorPrice) &&
    Array.isArray(item.usedInTasks) &&
    item.usedInTasks.length <= 1_000 &&
    item.usedInTasks.every(
      (task) => typeof task?.name === "string" && task.name.length <= 500
    ) &&
    (item.changeLast48hPercent === null ||
      (typeof item.changeLast48hPercent === "number" &&
        Number.isFinite(item.changeLast48hPercent)))
  );
}

function isComposedItem(value: unknown): value is ComposedItem {
  if (!isCachedItem(value)) return false;
  const item = value as Partial<ComposedItem>;
  const tasks = item.usedInTasks;
  if (!tasks) return false;
  return (
    tasks.length <= 1_000 &&
    tasks.every(
      (task) =>
        typeof task.name === "string" &&
        task.name.length <= 500 &&
        typeof task.minPlayerLevel === "number" &&
        (task.wikiLink === null || task.wikiLink === undefined || isSafeHttpsUrl(task.wikiLink)) &&
        Boolean(task.trader) &&
        typeof task.trader.name === "string" &&
        Array.isArray(task.objectives) &&
        task.objectives.length <= 1_000 &&
        task.objectives.every(
          (objective) =>
            objective.description === null ||
            (typeof objective.description === "string" && objective.description.length <= 10_000)
        )
    ) &&
    Array.isArray(item.bartersUsing) &&
    item.bartersUsing.length <= 5_000 &&
    item.bartersUsing.every(isBarter) &&
    Array.isArray(item.craftsUsing) &&
    item.craftsUsing.length <= 5_000 &&
    item.craftsUsing.every(isCraft)
  );
}

function isVendorPrice(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const price = value as { priceRUB?: unknown; vendor?: { name?: unknown } };
  return (
    typeof price.priceRUB === "number" &&
    Number.isFinite(price.priceRUB) &&
    Boolean(price.vendor) &&
    typeof price.vendor?.name === "string" &&
    price.vendor.name.length <= 500
  );
}

function isContainedItems(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 1_000 &&
    value.every(
      (entry: unknown) =>
        Boolean(entry) &&
        typeof (entry as { quantity?: unknown }).quantity === "number" &&
        Number.isFinite((entry as { quantity: number }).quantity) &&
        typeof (entry as { item?: { name?: unknown } }).item?.name === "string" &&
        ((entry as { item: { name: string } }).item.name.length <= 500)
    )
  );
}

function isBarter(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const barter = value as Partial<ComposedItem["bartersUsing"][number]>;
  return (
    typeof barter.level === "number" &&
    typeof barter.trader?.name === "string" && barter.trader.name.length <= 500 &&
    isTaskUnlock(barter.taskUnlock) &&
    isContainedItems(barter.requiredItems) &&
    isContainedItems(barter.rewardItems) &&
    Boolean(barter.rewardItems?.length)
  );
}

function isCraft(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const craft = value as Partial<ComposedItem["craftsUsing"][number]>;
  return (
    typeof craft.level === "number" &&
    typeof craft.station?.name === "string" && craft.station.name.length <= 500 &&
    isTaskUnlock(craft.taskUnlock) &&
    isContainedItems(craft.requiredItems) &&
    isContainedItems(craft.rewardItems) &&
    Boolean(craft.rewardItems?.length)
  );
}

function isTaskUnlock(value: unknown) {
  if (value === null || value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const unlock = value as { name?: unknown; wikiLink?: unknown };
  return (
    typeof unlock.name === "string" && unlock.name.length <= 500 &&
    (unlock.wikiLink === null || unlock.wikiLink === undefined || isSafeHttpsUrl(unlock.wikiLink))
  );
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isSafeAssetUrl(value: unknown): value is string {
  if (!isSafeHttpsUrl(value)) return false;
  return new URL(value).hostname === "assets.tarkov.dev";
}
