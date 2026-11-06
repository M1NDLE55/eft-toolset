"use client";

import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";
import { MAX_LAYERS, MAX_LAYER_ID_LENGTH, MAX_MAP_KEY_LENGTH } from "./limits";

type StoredLayers = Record<string, string[]>;

export const LAYER_STORE: StoreDefinition<StoredLayers> = {
  key: "eft-toolset:raid-planner-layers",
  legacyKeys: ["raid-planner-layers"],
  version: 1,
  defaultValue: () => ({}),
  validate: (value): value is StoredLayers =>
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length <= 100 &&
    Object.entries(value as Record<string, unknown>).every(
      ([mapKey, ids]) =>
        mapKey.length <= MAX_MAP_KEY_LENGTH &&
        Array.isArray(ids) &&
        ids.length <= MAX_LAYERS &&
        ids.every((id) => typeof id === "string" && id.length <= MAX_LAYER_ID_LENGTH)
    ),
  recover: (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([mapKey, ids]) =>
            mapKey.length <= MAX_MAP_KEY_LENGTH &&
            Array.isArray(ids) &&
            ids.every((id) => typeof id === "string" && id.length <= MAX_LAYER_ID_LENGTH)
        )
        .slice(0, 100)
        .map(([mapKey, ids]) => [mapKey, (ids as string[]).slice(0, MAX_LAYERS)])
    );
  },
};

const EMPTY: string[] = [];

export function useStoredLayers(mapKey: string): string[] {
  return useStore(LAYER_STORE)[mapKey] ?? EMPTY;
}

export function writeStoredLayers(mapKey: string, ids: string[]) {
  writeStore(LAYER_STORE, { ...readStore(LAYER_STORE), [mapKey]: ids });
}
