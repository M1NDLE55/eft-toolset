"use client";

import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";

type StoredLayers = Record<string, string[]>;

const LAYER_STORE: StoreDefinition<StoredLayers> = {
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
        mapKey.length <= 80 &&
        Array.isArray(ids) &&
        ids.length <= 200 &&
        ids.every((id) => typeof id === "string" && id.length <= 120)
    ),
};

export function readStoredLayers(mapKey: string) {
  return new Set(readStore(LAYER_STORE)[mapKey] ?? []);
}

export function writeStoredLayers(mapKey: string, ids: Set<string>) {
  const all = readStore(LAYER_STORE);
  writeStore(LAYER_STORE, { ...all, [mapKey]: Array.from(ids) });
}
