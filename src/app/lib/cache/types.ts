import type { BarterOffer, TaskUnlock } from "@/app/lib/types/gunBuilder";

export interface CachedVendorPrice {
  vendor: { name: string };
  priceRUB: number;
  /** Trader buy offers: the loyalty level the offer needs. */
  minTraderLevel?: number;
  /** Trader buy offers: the task that unlocks the offer. */
  taskUnlock?: TaskUnlock;
  /** Weapon buy offers: the preset the trader sells, which the price is for. */
  preset?: string;
}

export interface CachedContainedItem {
  item: { name: string; normalizedName?: string | null };
  quantity: number;
  /** Craft inputs only: a tool the craft needs but gives back. */
  tool?: boolean;
}

export interface CachedTaskUnlock {
  name: string;
  wikiLink: string | null;
}

export interface CachedItem {
  id: string;
  normalizedName: string;
  name: string;
  shortName: string | null;
  gridImageLink: string | null;
  wikiLink: string | null;
  fleaMarketFee: number | null;
  width: number;
  height: number;
  changeLast48hPercent: number | null;
  buyFor: CachedVendorPrice[];
  sellFor: CachedVendorPrice[];
  usedInTasks: { name: string }[];
  /** True when the item can't be traded on the flea market in this game mode. */
  fleaBanned?: boolean;
  /** Player level needed to trade this item on the flea market. */
  fleaMinLevel?: number | null;
  /**
   * Set for weapons. width and height above are the stripped weapon's; this is the size of
   * the weapon's default build, which tarkov.dev's flea price is for.
   */
  weapon?: { defaultWidth: number | null; defaultHeight: number | null };
}

/** One row of the home screen's market board. */
export interface MarketRow {
  name: string;
  shortName: string | null;
  normalizedName: string | null;
  gridImageLink: string | null;
  /** Lowest flea listing for movers; best sell price for the per-slot list. */
  price: number;
  /** Where that price is from: "Flea" or a trader's name. */
  vendor: string;
  perSlot: number;
  changeLast48hPercent: number | null;
}

export interface MarketBoard {
  risers: MarketRow[];
  fallers: MarketRow[];
  perSlot: MarketRow[];
}

export interface CatalogItem {
  id: string;
  normalizedName: string | null;
  name: string;
  shortName: string | null;
  gridImageLink: string | null;
}

export type CatalogEntry = [
  id: string,
  name: string,
  shortName: string | null,
  image: string | null,
  normalizedName: string | null,
];

export interface CachedTaskObjective {
  description: string | null;
  /** tarkov.dev objective type, such as giveItem, findItem, plantItem, or shoot. */
  type?: string | null;
  count?: number | null;
  foundInRaid?: boolean | null;
  optional?: boolean;
  /** How many other items also satisfy the objective; 0 when only this item does. */
  alternatives?: number;
}

export interface CachedTask {
  name: string;
  minPlayerLevel: number;
  wikiLink: string | null;
  trader: { name: string };
  /** USEC or BEAR when only that faction gets the task. */
  faction?: string | null;
  objectives: CachedTaskObjective[];
}

/** One hideout station upgrade that consumes the item. */
export interface CachedHideoutRequirement {
  station: { name: string };
  level: number;
  count: number;
  foundInRaid: boolean;
}

/** Slots a hideout station level adds that the item is installed in (and not consumed by). */
export interface CachedHideoutSlot {
  station: { name: string };
  level: number;
  slots: number;
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

/** Item page facts beyond prices and uses. */
export interface CachedItemInfo {
  description: string | null;
  /** Kilograms. */
  weight: number | null;
  /** The handbook price traders' prices are based on. */
  basePrice: number | null;
  avg24hPrice: number | null;
  low24hPrice: number | null;
  high24hPrice: number | null;
  /** Lowest flea listing at the last scan, before any fee. */
  lastLowPrice: number | null;
  /** Flea listings at the last scan. */
  lastOfferCount: number | null;
  stackMaxSize: number | null;
  /** Item categories, most specific first. */
  categories: string[];
}

/** For keys: the maps with locks it opens, and what it opens. */
export interface CachedKeyInfo {
  /** Maps with a keys page (src/app/lib/raid-planner/maps-config.ts mapConfigs key) where the key opens locks, in mapConfigs order. */
  maps: { key: string; name: string; locks: number }[];
  /** What the key opens, in words: the wiki infobox "usage" field (e.g. "Unlocks the driver-side door of the orange tanker truck at the construction site on Customs."); null without one. */
  opens: string | null;
}

export interface ComposedItem extends Omit<CachedItem, "usedInTasks"> {
  usedInTasks: CachedTask[];
  hideoutRequirements: CachedHideoutRequirement[];
  hideoutSlots: CachedHideoutSlot[];
  bartersUsing: CachedBarter[];
  /** Barters that give the item, with input prices, for the MCP tools. */
  bartersFor?: BarterOffer[];
  craftsUsing: CachedCraft[];
  /** Barters and crafts that give the item, for the item page. */
  bartersGiving?: CachedBarter[];
  craftsGiving?: CachedCraft[];
  info?: CachedItemInfo;
  /** Set for items that open at least one lock on a map, or whose wiki page says what they open. */
  key?: CachedKeyInfo;
}

/** What an item is needed for, without prices: the input to the needs summary. */
export interface ItemUses {
  usedInTasks: CachedTask[];
  hideoutRequirements: CachedHideoutRequirement[];
  hideoutSlots: CachedHideoutSlot[];
}
