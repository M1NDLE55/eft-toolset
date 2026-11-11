export interface ModSlotDef {
  id: string;
  name: string;
  nameId: string;
  required: boolean;
  allowedItemIds: string[];
}

/** The task a trader offer or barter is locked behind. */
// A type, not an interface, so results that carry it fit the MCP output schemas' open objects.
export type TaskUnlock = {
  id: string;
  name: string;
  /** The trader who gives the task. */
  trader: string | null;
  minPlayerLevel: number | null;
};

/** One trader's offer for an item, with the loyalty level it needs. */
export interface TraderOffer {
  trader: string;
  priceRUB: number;
  level: number | null;
  /** Set when the trader sells it only after this task is completed. */
  taskUnlock?: TaskUnlock;
  /** Set when the trader sells the weapon only as this preset; priceRUB is the preset's. */
  preset?: string;
}

/** A trader barter that gives the item, priced at the rouble value of what it takes. */
export interface BarterOffer {
  trader: string;
  /** What the barter takes, per item it gives, at the inputs' cheapest buy price. */
  priceRUB: number;
  level: number | null;
  taskUnlock?: TaskUnlock;
  /** Set when the barter gives the weapon as this preset. */
  preset?: string;
  /** What the barter takes for one trade, and how many of the item that trade gives. */
  requiredItems: { name: string; count: number }[];
  count: number;
}

/** What kind of aiming part an item is: an optic, an iron sight, or a part with a built-in front sight. */
export type SightKind = "optic" | "iron" | "front";

export interface ItemExtras {
  normalizedName?: string;
  traderName?: string | null;
  traderLevel?: number | null;
  /** Every trader offer, cheapest first; traderPriceRUB and traderName describe the cheapest. */
  traderOffers?: TraderOffer[];
  /** The task the cheapest trader offer needs, if any. */
  traderTask?: string | null;
  /** Barters that give the item, cheapest first (MCP lookups only); barterPriceRUB is the cheapest. */
  barterOffers?: BarterOffer[];
  barterPriceRUB?: number | null;
  fleaBanned?: boolean;
  /** Magazines only: how many rounds it holds. */
  capacity?: number | null;
  sight?: SightKind | null;
}

export interface BuildItemData extends ItemExtras {
  id: string;
  name: string;
  shortName: string;
  gridImageLink: string | null;
  weight: number;
  traderPriceRUB: number | null;
  fleaPriceRUB: number | null;
  ergonomics: number;
  recoilModifier: number;
  recoilVertical: number | null;
  recoilHorizontal: number | null;
  isWeapon: boolean;
  caliber?: string | null;
  fireRate?: number | null;
  fireModes?: string[];
  defaultAmmoName?: string | null;
  defaultPresetId?: string | null;
  presets?: { id: string; name: string }[];
  conflictingItemIds: string[];
  conflictingSlotIds: string[];
  slots: ModSlotDef[];
  allowedAmmoIds?: string[];
}

export interface AmmoItemData {
  id: string;
  normalizedName: string;
  name: string;
  shortName: string;
  gridImageLink: string | null;
  caliber: string | null;
  damage: number;
  penetrationPower: number;
  armorDamage: number;
  fragmentationChance: number;
  projectileCount: number;
  initialSpeed: number | null;
  recoilModifier: number;
  accuracyModifier: number;
  traderPriceRUB: number | null;
  fleaPriceRUB: number | null;
  traderName: string | null;
  traderLevel: number | null;
  traderOffers?: TraderOffer[];
  traderTask?: string | null;
  barterOffers?: BarterOffer[];
  barterPriceRUB?: number | null;
  fleaBanned?: boolean;
}

export interface PickItemData extends ItemExtras {
  id: string;
  name: string;
  shortName: string;
  gridImageLink: string | null;
  weight: number;
  traderPriceRUB: number | null;
  fleaPriceRUB: number | null;
  ergonomics: number;
  recoilModifier: number;
  conflictingItemIds: string[];
  conflictingSlotIds: string[];
}

export interface PriceSources {
  traders: boolean;
  flea: boolean;
  /** Trader barters, priced at what they take. Only the MCP tools offer it. */
  barters?: boolean;
}

export interface GunListItem {
  id: string;
  name: string;
  shortName: string;
  gridImageLink: string | null;
  defaultPresetId: string | null;
}

export interface BuildNode {
  itemId: string;
  slots: Record<string, BuildNode>;
}

export interface GunBuild {
  id: string;
  name: string;
  weaponId: string;
  root: BuildNode;
  ammoId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PresetContents {
  baseItemId: string | null;
  itemIds: string[];
}

export type GunItem = PickItemData | BuildItemData;
