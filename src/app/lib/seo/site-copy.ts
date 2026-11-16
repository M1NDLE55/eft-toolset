/** Names and copy shared by page metadata, navigation and structured data. */

export const SITE_NAME = "EFT Toolset";

export const HOME_TITLE = "EFT Toolset: Tarkov Flea Market Prices, Interactive Maps & Gun Builder";
export const HOME_DESCRIPTION =
  "Free Escape from Tarkov tools: live flea market and trader prices for every item, interactive maps with extracts, spawns and keys, a gun builder with a recoil optimiser, and a raid planner. PVP and PVE.";

export const ITEM_HUB_NAME = "Tarkov item prices";
export const ITEM_HUB_TITLE = "Tarkov Flea Market Prices: Live Item Price Checker (PVP & PVE)";
export const ITEM_HUB_DESCRIPTION =
  "Check live Escape from Tarkov flea market and trader prices for any item, the best place to sell it, price per slot, and every task, hideout upgrade, barter and craft that needs it. PVP and PVE.";

export const GUN_BUILDER_TITLE = "Tarkov Gun Builder: Weapon Mod Builder & Recoil Optimizer";
export const GUN_BUILDER_DESCRIPTION =
  "Build any Escape from Tarkov weapon part by part with live ergonomics, recoil, weight and flea prices. Optimise for lowest recoil, best ergonomics or a budget, pick ammo, compare builds and share them.";

export const RAID_PLANNER_TITLE = "Tarkov Raid Planner & Interactive Maps";
export const RAID_PLANNER_DESCRIPTION =
  "Plan Escape from Tarkov raids on interactive maps of every location: extracts, transits, spawns, bosses, keys and loot. Draw routes and notes, measure distances and share plans with your squad.";

export function mapPageTitle(mapName: string) {
  return `Tarkov ${mapName} Map: Extracts, Spawns & Keys`;
}
