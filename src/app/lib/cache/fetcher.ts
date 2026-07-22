import type { GameMode } from "@/components/game-mode/context";
import { gqlFetch } from "@/app/lib/api/transport";
import type { QueryDefinition } from "@/app/lib/api/queryClient";
import { GET_ITEM, GROUP_ITEMS, ITEM_CATALOG } from "./queries";
import type { CachedItem, CatalogItem, ComposedItem } from "./types";

const PAGE_SIZE = 500;
const MAX_PAGES = 100;
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

export const itemCatalogQuery: QueryDefinition<ModeVariables, CatalogItem[]> = {
  id: "item-catalog",
  version: 1,
  staleTime: DAY,
  maxAge: 30 * DAY,
  persist: true,
  validate: isCatalog,
  fetch: ({ gameMode }, signal) =>
    fetchPaginated<CatalogItem>(ITEM_CATALOG, "items", gameMode, signal),
};

export const groupItemsQuery: QueryDefinition<GroupVariables, CachedItem[]> = {
  id: "group-items",
  version: 1,
  staleTime: 10 * MINUTE,
  maxAge: 30 * DAY,
  persist: true,
  validate: isCachedItems,
  fetch: async ({ names, gameMode }, signal) => {
    const uniqueNames = Array.from(new Set(names.filter(Boolean))).sort();
    if (uniqueNames.length === 0) return [];
    return fetchNamesBatched<CachedItem>(GROUP_ITEMS, uniqueNames, gameMode, signal);
  },
};

async function fetchNamesBatched<T>(
  query: string,
  names: string[],
  gameMode: GameMode,
  signal: AbortSignal
): Promise<T[]> {
  const batches = chunk(names, NAME_BATCH_SIZE);
  const results: T[] = [];
  for (let index = 0; index < batches.length; index += BATCH_CONCURRENCY) {
    const responses = await Promise.all(
      batches.slice(index, index + BATCH_CONCURRENCY).map((batch) =>
        gqlFetch<{ items: T[] }>(
          query,
          { names: batch, gameMode },
          { signal, operationName: "GroupItems" }
        )
      )
    );
    for (const response of responses) results.push(...(response.items ?? []));
  }
  return results;
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export const itemDetailQuery: QueryDefinition<GroupVariables, ComposedItem | null> = {
  id: "item-detail",
  version: 1,
  staleTime: 5 * MINUTE,
  maxAge: 30 * DAY,
  persist: true,
  validate: (value): value is ComposedItem | null => value === null || isComposedItem(value),
  fetch: async ({ names, gameMode }, signal) => {
    const name = names.find(Boolean);
    if (!name) return null;
    const data = await gqlFetch<{ items: ComposedItem[] }>(
      GET_ITEM,
      { names: [name], gameMode },
      { signal, operationName: "GetItem" }
    );
    return data.items?.find((item) => item.name === name) ?? data.items?.[0] ?? null;
  },
};

async function fetchPaginated<T extends { id: string }>(
  query: string,
  rootField: string,
  gameMode: GameMode,
  signal: AbortSignal
): Promise<T[]> {
  const results: T[] = [];
  const seen = new Set<string>();

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const data = await gqlFetch<Record<string, T[]>>(
      query,
      { gameMode, limit: PAGE_SIZE, offset: pageNumber * PAGE_SIZE },
      { signal, operationName: "ItemCatalog" }
    );
    const page = data[rootField] ?? [];
    let newRows = 0;
    for (const row of page) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      results.push(row);
      newRows += 1;
    }

    if (page.length < PAGE_SIZE) return results;
    if (newRows === 0) throw new Error(`Pagination for ${rootField} repeated a page.`);
  }

  throw new Error(`Pagination for ${rootField} exceeded ${MAX_PAGES} pages.`);
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
    (item.gridImageLink === null || typeof item.gridImageLink === "string")
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
    typeof item.normalizedName === "string" &&
    typeof item.name === "string" &&
    typeof item.width === "number" &&
    typeof item.height === "number" &&
    Array.isArray(item.buyFor) &&
    item.buyFor.every(isVendorPrice) &&
    Array.isArray(item.sellFor) &&
    item.sellFor.every(isVendorPrice) &&
    Array.isArray(item.usedInTasks)
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
        typeof task.minPlayerLevel === "number" &&
        Boolean(task.trader) &&
        typeof task.trader.name === "string" &&
        Array.isArray(task.objectives)
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
    typeof price.vendor?.name === "string"
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
        typeof (entry as { item?: { name?: unknown } }).item?.name === "string"
    )
  );
}

function isBarter(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const barter = value as Partial<ComposedItem["bartersUsing"][number]>;
  return (
    typeof barter.level === "number" &&
    typeof barter.trader?.name === "string" &&
    isContainedItems(barter.requiredItems) &&
    isContainedItems(barter.rewardItems)
  );
}

function isCraft(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const craft = value as Partial<ComposedItem["craftsUsing"][number]>;
  return (
    typeof craft.level === "number" &&
    typeof craft.station?.name === "string" &&
    isContainedItems(craft.requiredItems) &&
    isContainedItems(craft.rewardItems)
  );
}
