"use client";

import { useMemo } from "react";
import { useDataQuery } from "@/app/lib/api/useDataQuery";
import { groupItemsQuery, itemDetailQuery } from "./fetcher";
import { useBulkCache } from "./provider";
import type { CachedItem, ComposedItem } from "./types";

export function useCacheReady(): boolean {
  return useBulkCache().ready;
}

export function useItem(name: string): {
  item: ComposedItem | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<ComposedItem | null>;
} {
  const { gameMode } = useBulkCache();
  const variables = useMemo(() => ({ names: name ? [name] : [], gameMode }), [gameMode, name]);
  const query = useDataQuery(itemDetailQuery, variables, { enabled: Boolean(name) });

  return {
    item: query.data ?? null,
    loading: Boolean(name) && (query.status === "idle" || query.status === "loading"),
    error: query.error ?? null,
    refresh: query.refresh,
  };
}

export function useItemsInGroup(names: string[]): {
  items: CachedItem[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<CachedItem[]>;
} {
  const { gameMode } = useBulkCache();
  const stableNames = useMemo(() => Array.from(new Set(names)).sort(), [names]);
  const variables = useMemo(() => ({ names: stableNames, gameMode }), [gameMode, stableNames]);
  const query = useDataQuery(groupItemsQuery, variables, { enabled: stableNames.length > 0 });
  const order = useMemo(() => new Map(names.map((name, index) => [name, index])), [names]);
  const items = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0)),
    [order, query.data]
  );

  return {
    items,
    loading: stableNames.length > 0 && (query.status === "idle" || query.status === "loading"),
    error: query.error ?? null,
    refresh: query.refresh,
  };
}

export function useItemPreview(
  name: string
): { gridImageLink: string | null; loading: boolean } {
  const { ready, loading, itemsByName } = useBulkCache();
  return useMemo(
    () => ({
      gridImageLink: itemsByName.get(name)?.gridImageLink ?? null,
      loading: Boolean(name) && !ready && loading,
    }),
    [itemsByName, loading, name, ready]
  );
}
