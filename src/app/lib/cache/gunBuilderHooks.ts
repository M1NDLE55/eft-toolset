"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGameMode } from "@/components/game-mode/context";
import type { BuildItemData, GunListItem } from "@/app/lib/types/gunBuilder";
import { fetchBuildItems, fetchGunList } from "./gunBuilder";

export function useGunList() {
  const { gameMode } = useGameMode();
  const [guns, setGuns] = useState<GunListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGunList(gameMode)
      .then((items) => {
        if (!cancelled) setGuns(items);
      })
      .catch(console.warn)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gameMode]);

  return { guns, loading, gameMode };
}

export function useBuildItemData(initialIds: string[]) {
  // Builds are mode-agnostic: item data (prices, stats) always resolves against
  // the active game mode, so toggling the mode live-converts the open build.
  // The reset effect below clears the map on mode change and reloads the ids.
  const { gameMode } = useGameMode();
  const [items, setItems] = useState<Map<string, BuildItemData>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  // Mirror `items` in a ref so `loadBuildItems` can stay referentially stable.
  // Keeping `items` in the callback deps recreates it on every load, which
  // re-fires the consumers' effects (initial load + slot picker) and triggers
  // redundant fetch passes.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const loadBuildItems = useCallback(
    async (ids: string[]) => {
      const missing = Array.from(new Set(ids)).filter(
        (id) => id && !itemsRef.current.has(id)
      );
      if (missing.length === 0) return [];

      setLoadingIds((prev) => new Set([...Array.from(prev), ...missing]));
      try {
        const fetched = await fetchBuildItems(missing, gameMode);
        setItems((prev) => {
          const next = new Map(prev);
          for (const item of fetched) next.set(item.id, item);
          return next;
        });
        return fetched;
      } finally {
        setLoadingIds((prev) => {
          const next = new Set(prev);
          for (const id of missing) next.delete(id);
          return next;
        });
      }
    },
    [gameMode]
  );

  useEffect(() => {
    itemsRef.current = new Map();
    setItems(new Map());
  }, [gameMode]);

  useEffect(() => {
    loadBuildItems(initialIds).catch(console.warn);
  }, [initialIds, loadBuildItems]);

  const loading = loadingIds.size > 0;

  return { items, loading, loadingIds, gameMode, loadBuildItems };
}
