import {
  getAmmoItems,
  getGunList,
  getGunPartLookup,
  getItemCatalog,
  getMapDetails,
  getPreset,
} from "@/app/lib/api/tarkov-server";
import type { BuildSource } from "@/app/lib/builds/resolve";
import { itemHref } from "@/app/lib/item-links";
import type { MapConfig } from "@/app/lib/raid-planner/types";
import { indexCatalog, type CatalogIndex } from "@/app/lib/search/item-reference";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { InputError, type GameMode, type Read, type ToolContext } from "./context";

// Data loaders and links shared by the tool modules. Loaders read through the tool's reader
// so cancellation and freshness tracking apply.

export async function loadCatalogIndex(read: Read, gameMode: GameMode): Promise<CatalogIndex> {
  return indexCatalog(await read(() => getItemCatalog(gameMode)));
}

/** Loads the part data a build needs, with loaders for presets and ammo. */
export async function loadBuildSource(read: Read, gameMode: GameMode): Promise<BuildSource> {
  const [lookup, guns] = await Promise.all([
    read(() => getGunPartLookup(gameMode)),
    read(() => getGunList(gameMode)),
  ]);
  return {
    gameMode,
    lookup,
    guns,
    loadPreset: (id) => read(() => getPreset(gameMode, id)),
    loadAmmo: (ids) => read(() => getAmmoItems(gameMode, [...ids])),
  };
}

export async function loadMapDetails(read: Read, gameMode: GameMode, config: MapConfig): Promise<MapDetails> {
  const details = await read(() => getMapDetails(gameMode, config.key));
  if (!details) throw new InputError(`tarkov.dev has no data for ${config.name} in ${gameMode} mode.`);
  return details;
}

export function itemUrl(context: ToolContext, item: { name: string; normalizedName?: string | null }) {
  return `${context.origin}${itemHref(item)}`;
}
