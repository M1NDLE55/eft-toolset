"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useBulkCache } from "./provider";
import type { CachedItem, ComposedItem } from "./types";
import {
  getBartersUsingItem,
  getCraftsUsingItem,
  getUsedInTasks,
} from "./relations";
import { fetchSingleItem } from "./fetcher";

export function useCacheReady(): boolean {
  const { ready } = useBulkCache();
  return ready;
}

export function useItem(
  name: string
): { item: ComposedItem | null; loading: boolean } {
  const { ready, gameMode, items, tasks, barters, crafts, updateItem } =
    useBulkCache();
  const [fresh, setFresh] = useState<ComposedItem | null>(null);
  const fetchedRef = useRef<string | null>(null);

  // Compose item from bulk cache
  const cached = useMemo(() => {
    if (!ready) return null;
    const item = items.get(name);
    if (!item) return null;

    const taskNames = item.usedInTasks.map((t) => t.name);
    const composed: ComposedItem = {
      ...item,
      usedInTasks: getUsedInTasks(taskNames, tasks),
      bartersUsing: getBartersUsingItem(name, barters),
      craftsUsing: getCraftsUsingItem(name, crafts),
    };
    return composed;
  }, [ready, items, tasks, barters, crafts, name]);

  // Fetch fresh data for this specific item in background
  useEffect(() => {
    if (!ready || !name) return;
    // Don't re-fetch if we already fetched this item this mount
    if (fetchedRef.current === `${name}:${gameMode}`) return;
    fetchedRef.current = `${name}:${gameMode}`;

    fetchSingleItem(name, gameMode)
      .then((result) => {
        if (!result) return;
        setFresh(result);

        // Update the item in the bulk cache (core fields only)
        const { bartersUsing, craftsUsing, usedInTasks, ...coreFields } =
          result;
        const updatedCacheEntry: CachedItem = {
          ...coreFields,
          usedInTasks: usedInTasks.map((t) => ({ name: t.name })),
        };
        updateItem(name, updatedCacheEntry);
      })
      .catch(console.warn);
  }, [ready, name, gameMode, updateItem]);

  // Reset fresh when name/mode changes
  useEffect(() => {
    setFresh(null);
  }, [name, gameMode]);

  if (!ready) return { item: null, loading: true };
  // Return fresh data if available, otherwise cached
  return { item: fresh ?? cached, loading: false };
}

export function useItemsInGroup(
  names: string[]
): { items: CachedItem[]; loading: boolean } {
  const { ready, items: allItems } = useBulkCache();

  return useMemo(() => {
    if (!ready) return { items: [], loading: true };
    const result: CachedItem[] = [];
    for (const name of names) {
      const item = allItems.get(name);
      if (item) result.push(item);
    }
    return { items: result, loading: false };
  }, [ready, allItems, names]);
}

export function useItemPreview(
  name: string
): { gridImageLink: string | null; loading: boolean } {
  const { ready, items } = useBulkCache();

  return useMemo(() => {
    if (!ready || !name) return { gridImageLink: null, loading: !!name };
    const cached = items.get(name);
    return {
      gridImageLink: cached?.gridImageLink ?? null,
      loading: false,
    };
  }, [ready, items, name]);
}
