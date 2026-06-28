export interface ModSlotDef {
  id: string;
  name: string;
  nameId: string;
  required: boolean;
  allowedItemIds: string[];
}

export interface BuildItemData {
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
}

/**
 * Lightweight projection used to populate the slot picker. Omits the recursive
 * `slots` tree (the heavy part of `BuildItemData`) — full detail is fetched only
 * when a mod is actually attached.
 */
export interface PickItemData {
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

/** Which purchase sources feed the "cheapest price" used for build cost. */
export interface PriceSources {
  traders: boolean;
  flea: boolean;
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
  createdAt: number;
  updatedAt: number;
}

export interface PresetContents {
  baseItemId: string | null;
  itemIds: string[];
}
