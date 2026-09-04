"use client";

import React, { createContext, useContext, useMemo } from "react";
import { useGameMode, type GameMode } from "@/components/game-mode/context";
import { useDataQuery } from "@/app/lib/api/useDataQuery";
import { itemCatalogQuery } from "./fetcher";
import type { CatalogItem } from "./types";

interface DataCacheContextValue {
  ready: boolean;
  loading: boolean;
  error: Error | null;
  gameMode: GameMode;
  hydrated: boolean;
  stale: boolean;
  catalog: CatalogItem[];
  itemsByName: Map<string, CatalogItem>;
  refreshCatalog: () => Promise<CatalogItem[]>;
}

const DataCacheContext = createContext<DataCacheContextValue | undefined>(undefined);
const EMPTY_CATALOG: CatalogItem[] = [];

export function BulkCacheProvider({ children }: { children: React.ReactNode }) {
  const { gameMode, hydrated } = useGameMode();
  const variables = useMemo(() => ({ gameMode }), [gameMode]);
  const query = useDataQuery(itemCatalogQuery, variables, { enabled: hydrated });
  const catalog = query.data ?? EMPTY_CATALOG;
  const itemsByName = useMemo(
    () => new Map(catalog.map((item) => [item.name, item])),
    [catalog]
  );

  const value = useMemo<DataCacheContextValue>(
    () => ({
      ready: Boolean(query.data),
      loading: query.status === "loading",
      error: query.error ?? null,
      gameMode,
      hydrated,
      stale: query.stale,
      catalog,
      itemsByName,
      refreshCatalog: query.refresh,
    }),
    [catalog, gameMode, hydrated, itemsByName, query.data, query.error, query.refresh, query.stale, query.status]
  );

  return <DataCacheContext.Provider value={value}>{children}</DataCacheContext.Provider>;
}

export function useBulkCache(): DataCacheContextValue {
  const context = useContext(DataCacheContext);
  if (!context) throw new Error("useBulkCache must be used within BulkCacheProvider");
  return context;
}
