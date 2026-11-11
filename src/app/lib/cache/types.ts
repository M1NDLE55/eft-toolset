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

/** A barter that gives an item; priceRUB is null when one of its inputs has no price. */
export type ItemBarterOffer = Omit<BarterOffer, "priceRUB"> & { priceRUB: number | null };

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

export interface ComposedItem extends Omit<CachedItem, "usedInTasks"> {
  usedInTasks: CachedTask[];
  hideoutRequirements: CachedHideoutRequirement[];
  hideoutSlots: CachedHideoutSlot[];
  bartersUsing: CachedBarter[];
  /** Barters that give the item, for the MCP tools; the item page doesn't list them yet. */
  bartersFor?: ItemBarterOffer[];
  craftsUsing: CachedCraft[];
}

/** What an item is needed for, without prices: the input to the needs summary. */
export interface ItemUses {
  usedInTasks: CachedTask[];
  hideoutRequirements: CachedHideoutRequirement[];
  hideoutSlots: CachedHideoutSlot[];
}
