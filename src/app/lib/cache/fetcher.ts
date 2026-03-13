import {
  BULK_ITEMS,
  BULK_TASKS,
  BULK_BARTERS,
  BULK_CRAFTS,
  GET_ITEM,
} from "./queries";
import type {
  CachedItem,
  CachedTask,
  CachedBarter,
  CachedCraft,
  ComposedItem,
} from "./types";

const API_URL = "https://api.tarkov.dev/graphql";
const PAGE_SIZE = 500;

type GameMode = "regular" | "pve";

export interface FetchProgress {
  total: number;
  current: number;
  message: string;
}

async function gqlFetch<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    console.warn("GraphQL errors:", json.errors);
  }
  return json.data;
}

/**
 * Fetches all results for a query using offset/limit pagination.
 * Fetches pages sequentially to avoid hitting rate limits.
 */
async function fetchPaginated<T>(
  query: string,
  rootField: string,
  gameMode: GameMode,
  onProgress?: (itemsFetched: number) => void
): Promise<T[]> {
  let offset = 0;
  const allResults: T[] = [];

  while (true) {
    const data = await gqlFetch<Record<string, T[]>>(query, {
      gameMode,
      limit: PAGE_SIZE,
      offset,
    });
    
    const page = data[rootField] ?? [];
    allResults.push(...page);
    
    if (onProgress) {
      onProgress(allResults.length);
    }

    if (page.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return allResults;
}

export async function fetchBulkItems(
  gameMode: GameMode,
  onProgress?: (count: number) => void
): Promise<CachedItem[]> {
  return fetchPaginated<CachedItem>(BULK_ITEMS, "items", gameMode, onProgress);
}

export async function fetchBulkTasks(
  gameMode: GameMode,
  onProgress?: (count: number) => void
): Promise<CachedTask[]> {
  return fetchPaginated<CachedTask>(BULK_TASKS, "tasks", gameMode, onProgress);
}

export async function fetchBulkBarters(
  gameMode: GameMode,
  onProgress?: (count: number) => void
): Promise<CachedBarter[]> {
  return fetchPaginated<CachedBarter>(BULK_BARTERS, "barters", gameMode, onProgress);
}

export async function fetchBulkCrafts(
  gameMode: GameMode,
  onProgress?: (count: number) => void
): Promise<CachedCraft[]> {
  return fetchPaginated<CachedCraft>(BULK_CRAFTS, "crafts", gameMode, onProgress);
}

export async function fetchAll(
  gameMode: GameMode,
  onProgress?: (step: string, current: number) => void
) {
  const items = await fetchBulkItems(gameMode, (c) => onProgress?.("items", c));
  const tasks = await fetchBulkTasks(gameMode, (c) => onProgress?.("tasks", c));
  const barters = await fetchBulkBarters(gameMode, (c) => onProgress?.("barters", c));
  const crafts = await fetchBulkCrafts(gameMode, (c) => onProgress?.("crafts", c));
  
  return { items, tasks, barters, crafts };
}

export async function fetchSingleItem(
  name: string,
  gameMode: GameMode
): Promise<ComposedItem | null> {
  const data = await gqlFetch<{ items: ComposedItem[] }>(GET_ITEM, {
    name,
    gameMode,
  });
  return data.items?.[0] ?? null;
}
