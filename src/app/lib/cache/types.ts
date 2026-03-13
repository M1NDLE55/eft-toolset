export interface CachedVendorPrice {
  vendor: { name: string };
  priceRUB: number;
}

export interface CachedContainedItem {
  item: { name: string };
  quantity: number;
}

export interface CachedTaskUnlock {
  name: string;
  wikiLink: string | null;
}

export interface CachedItem {
  name: string;
  gridImageLink: string | null;
  wikiLink: string | null;
  fleaMarketFee: number | null;
  width: number;
  height: number;
  changeLast48hPercent: number | null;
  buyFor: CachedVendorPrice[];
  sellFor: CachedVendorPrice[];
  usedInTasks: { name: string }[];
}

export interface CachedTask {
  name: string;
  minPlayerLevel: number;
  wikiLink: string | null;
  trader: { name: string };
  objectives: { description: string | null }[];
}

export interface CachedBarter {
  trader: { name: string };
  level: number;
  taskUnlock: CachedTaskUnlock | null;
  requiredItems: CachedContainedItem[];
  rewardItems: CachedContainedItem[];
}

export interface CachedCraft {
  station: { name: string };
  level: number;
  taskUnlock: CachedTaskUnlock | null;
  requiredItems: CachedContainedItem[];
  rewardItems: CachedContainedItem[];
}

/** Composed item with full relations resolved from separate caches */
export interface ComposedItem extends Omit<CachedItem, "usedInTasks"> {
  usedInTasks: CachedTask[];
  bartersUsing: CachedBarter[];
  craftsUsing: CachedCraft[];
}

export interface CacheMeta {
  version: number;
  timestamp: number;
}
