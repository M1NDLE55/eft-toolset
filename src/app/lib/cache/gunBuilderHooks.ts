"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGameMode } from "@/components/game-mode/context";
import type { BuildItemData, GunListItem } from "@/app/lib/types/gunBuilder";
import { fetchBuildItems, fetchGunList } from "./gunBuilder";

export function useGunList() {
  const { gameMode, hydrated } = useGameMode();
  const [guns, setGuns] = useState<GunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGunList(gameMode)
      .then((items) => {
        if (!cancelled) setGuns(items);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason : new Error("Could not load weapons."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gameMode, hydrated, retryToken]);

  return {
    guns,
    loading,
    error,
    retry: () => setRetryToken((value) => value + 1),
    gameMode,
  };
}

export function useBuildItemData(initialIds: string[]) {
  // Builds are mode-agnostic: item data (prices, stats) always resolves against
  // the active game mode, so toggling the mode live-converts the open build.
  // The reset effect below clears the map on mode change and reloads the ids.
  const { gameMode, hydrated } = useGameMode();
  const [items, setItems] = useState<Map<string, BuildItemData>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  // Mirror `items` in a ref so `loadBuildItems` can stay referentially stable.
  // Keeping `items` in the callback deps recreates it on every load, which
  // re-fires the consumers' effects (initial load + slot picker) and triggers
  // redundant fetch passes.
  const itemsRef = useRef(items);
  const activeMode = useRef(gameMode);
  const inFlightIds = useRef(new Set<string>());
  itemsRef.current = items;
  activeMode.current = gameMode;

  const loadBuildItems = useCallback(
    async (ids: string[]) => {
      if (!hydrated) return [];
      const missing = Array.from(new Set(ids)).filter(
        (id) => id && !itemsRef.current.has(id) && !inFlightIds.current.has(id)
      );
      if (missing.length === 0) return [];

      for (const id of missing) inFlightIds.current.add(id);
      setLoadingIds((prev) => new Set([...Array.from(prev), ...missing]));
      try {
        const fetched = await fetchBuildItems(missing, gameMode);
        if (activeMode.current !== gameMode) return [];
        setItems((prev) => {
          const next = new Map(prev);
          for (const item of fetched) next.set(item.id, item);
          return next;
        });
        return fetched;
      } finally {
        for (const id of missing) inFlightIds.current.delete(id);
        setLoadingIds((prev) => {
          const next = new Set(prev);
          for (const id of missing) next.delete(id);
          return next;
        });
      }
    },
    [gameMode, hydrated]
  );

  useEffect(() => {
    inFlightIds.current.clear();
    itemsRef.current = new Map();
    setItems(new Map());
  }, [gameMode]);

  useEffect(() => {
    if (!hydrated) return;
    loadBuildItems(initialIds).catch(console.warn);
  }, [hydrated, initialIds, loadBuildItems]);

  const loading = loadingIds.size > 0;

  return { items, loading: !hydrated || loading, loadingIds, gameMode, loadBuildItems };
}
