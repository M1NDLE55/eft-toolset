"use client";

import { useMemo, useState } from "react";
import { useGameMode, type GameMode } from "@/components/game-mode/context";
import { useDataQuery } from "@/app/lib/api/useDataQuery";
import { primeQuery } from "@/app/lib/api/queryClient";
import { groupItemsQuery, itemCatalogQuery, itemDetailQuery, type ItemReference } from "./fetcher";
import type { CachedItem, CatalogItem, ComposedItem } from "./types";

const EMPTY_CATALOG: CatalogItem[] = [];
const nameIndexes = new WeakMap<CatalogItem[], Map<string, CatalogItem>>();

function nameIndex(catalog: CatalogItem[]) {
  let index = nameIndexes.get(catalog);
  if (!index) {
    index = new Map(catalog.map((item) => [item.name, item]));
    nameIndexes.set(catalog, index);
  }
  return index;
}

export function useCatalog() {
  const { gameMode, hydrated } = useGameMode();
  const variables = useMemo(() => ({ gameMode }), [gameMode]);
  const query = useDataQuery(itemCatalogQuery, variables, { enabled: hydrated });
  const catalog = query.data ?? EMPTY_CATALOG;
  return {
    catalog,
    itemsByName: nameIndex(catalog),
    loading: !query.data && query.status !== "error",
    error: query.error ?? null,
    stale: query.stale,
    refresh: query.refresh,
  };
}

export function primeItem(reference: ItemReference, gameMode: GameMode, item: ComposedItem) {
  primeQuery(itemDetailQuery, { ...reference, gameMode } as ItemReference & { gameMode: GameMode }, item);
}

export function useItem(reference: ItemReference): {
  item: ComposedItem | null;
  loading: boolean;
  error: Error | null;
  stale: boolean;
  refresh: () => Promise<ComposedItem | null>;
} {
  const { gameMode, hydrated } = useGameMode();
  const variables = { ...reference, gameMode } as ItemReference & { gameMode: GameMode };
  const query = useDataQuery(itemDetailQuery, variables, { enabled: hydrated });

  return {
    item: query.data ?? null,
    loading: query.status === "idle" || query.status === "loading",
    error: query.error ?? null,
    stale: query.stale,
    refresh: query.refresh,
  };
}

export function useItemsInGroup(names: string[]): {
  items: CachedItem[];
  loading: boolean;
  error: Error | null;
  stale: boolean;
  refresh: () => Promise<CachedItem[]>;
} {
  const { gameMode, hydrated } = useGameMode();
  const stableNames = useMemo(() => Array.from(new Set(names)).sort(), [names]);
  const variables = useMemo(() => ({ names: stableNames, gameMode }), [gameMode, stableNames]);
  const query = useDataQuery(groupItemsQuery, variables, {
    enabled: hydrated && stableNames.length > 0,
  });
  const [previous, setPrevious] = useState<{ gameMode: GameMode; data: CachedItem[] } | null>(null);
  if (query.data && query.data !== previous?.data) setPrevious({ gameMode, data: query.data });
  const data = query.data ?? (previous?.gameMode === gameMode ? previous.data : undefined);
  const items = useMemo(() => {
    const wanted = new Set(names);
    return (data ?? []).filter((item) => wanted.has(item.name));
  }, [names, data]);

  return {
    items,
    loading: stableNames.length > 0 && !data && (query.status === "idle" || query.status === "loading"),
    error: query.error ?? null,
    stale: query.stale,
    refresh: query.refresh,
  };
}
