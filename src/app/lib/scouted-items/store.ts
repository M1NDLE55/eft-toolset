import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";
import { isItemSlug } from "@/app/lib/item-links";

export interface ScoutedItem {
  name: string;
  gridImageLink: string | null;
  normalizedName?: string | null;
}

const MAX_SCOUTED = 20;
export const SCOUTED_STORE: StoreDefinition<ScoutedItem[]> = {
  key: "eft-toolset:scouted-items",
  version: 1,
  defaultValue: () => [],
  validate: isScoutedList,
  recover: recoverScoutedItems,
};

function isScoutedList(value: unknown): value is ScoutedItem[] {
  return Array.isArray(value) && value.length <= MAX_SCOUTED && value.every(isScoutedItem);
}

function isScoutedItem(value: unknown): value is ScoutedItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ScoutedItem>;
  return (
    typeof item.name === "string" &&
    item.name.length <= 240 &&
    (item.gridImageLink === null || isSafeAssetUrl(item.gridImageLink)) &&
    (item.normalizedName === undefined || item.normalizedName === null || (typeof item.normalizedName === "string" && isItemSlug(item.normalizedName)))
  );
}

function recoverScoutedItems(value: unknown): ScoutedItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((candidate): ScoutedItem[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<ScoutedItem>;
    if (typeof item.name !== "string" || item.name.length > 240) return [];
    return [{
      name: item.name,
      gridImageLink: isSafeAssetUrl(item.gridImageLink) ? item.gridImageLink : null,
      normalizedName: typeof item.normalizedName === "string" && isItemSlug(item.normalizedName) ? item.normalizedName : null,
    }];
  }).slice(0, MAX_SCOUTED);
}

function isSafeAssetUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "assets.tarkov.dev" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const COLLAPSED_STORE: StoreDefinition<boolean> = {
  key: "eft-toolset:scouted-collapsed",
  version: 1,
  defaultValue: () => false,
  validate: (value): value is boolean => typeof value === "boolean",
};

export function addScoutedItem(item: ScoutedItem) {
  const filtered = readStore(SCOUTED_STORE).filter((candidate) => candidate.name !== item.name);
  writeStore(SCOUTED_STORE, [item, ...filtered].slice(0, MAX_SCOUTED));
}

export function useScoutedItems() {
  return useStore(SCOUTED_STORE);
}

export function useScoutedCollapsed() {
  return useStore(COLLAPSED_STORE);
}

export function clearScoutedItems() {
  writeStore(SCOUTED_STORE, []);
}

export function setScoutedCollapsed(collapsed: boolean) {
  writeStore(COLLAPSED_STORE, collapsed);
}
