"use client";

import {
  readStore,
  subscribeStore,
  writeStore,
  type StoreDefinition,
} from "@/app/lib/storage/versioned-store";

export interface ScoutedItem {
  name: string;
  gridImageLink: string | null;
}

const MAX_SCOUTED = 20;
const ITEMS_STORE: StoreDefinition<ScoutedItem[]> = {
  key: "eft-toolset:scouted-items",
  version: 1,
  defaultValue: () => [],
  validate: (value): value is ScoutedItem[] =>
    Array.isArray(value) &&
    value.length <= MAX_SCOUTED &&
    value.every(
      (item: unknown) =>
        Boolean(item) &&
        typeof (item as ScoutedItem).name === "string" &&
        (item as ScoutedItem).name.length <= 240 &&
        ((item as ScoutedItem).gridImageLink === null ||
          typeof (item as ScoutedItem).gridImageLink === "string")
    ),
};

const COLLAPSED_STORE: StoreDefinition<boolean> = {
  key: "eft-toolset:scouted-collapsed",
  version: 1,
  defaultValue: () => false,
  validate: (value): value is boolean => typeof value === "boolean",
};

export function addScoutedItem(item: ScoutedItem) {
  const filtered = readStore(ITEMS_STORE).filter((candidate) => candidate.name !== item.name);
  writeStore(ITEMS_STORE, [item, ...filtered].slice(0, MAX_SCOUTED));
}

export function listScoutedItems() {
  return readStore(ITEMS_STORE);
}

export function subscribeScoutedItems(listener: () => void) {
  return subscribeStore(ITEMS_STORE.key, listener);
}

export function getScoutedCollapsed() {
  return readStore(COLLAPSED_STORE);
}

export function setScoutedCollapsed(collapsed: boolean) {
  writeStore(COLLAPSED_STORE, collapsed);
}
