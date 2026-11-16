import { getGunList, getGunPartLookup, getItemFacets, getPreset } from "@/app/lib/api/tarkov-server";
import type { GameMode } from "@/components/game-mode/mode";
import type { BuildNode, PriceSources } from "@/app/lib/types/gunBuilder";
import type { PriceSource } from "./price";
import { optimizeBuild, type OptimizeGoal } from "./optimizer";
import { releaseOptimizerSlot, tryAcquireOptimizerSlot } from "./optimizer-slots";
import { reconstructPresetTree } from "./presets";
import { presetParts } from "./purchase";
import { computeStats } from "./stats";
import { buildShoppingList } from "./shopping";
import { slotLabel, type PartLookup } from "./resolve";
import { encodeBuildSharePayload, slugifyBuildName } from "./share";
import { formatCaliber } from "@/app/lib/mcp/build-projection";
import { isItemSlug } from "@/app/lib/item-links";

/** Traders and the flea market: what most players buy from. */
export const BEST_BUILD_PRICES: PriceSources = { traders: true, flea: true };

export type BestBuildKind = "preset" | Exclude<OptimizeGoal, "cost">;

/** Weapon classes in the order the hub lists them, matched against tarkov.dev's item categories. */
export const WEAPON_CLASSES = [
  { name: "Assault rifles", categories: ["assault rifle"] },
  { name: "Assault carbines", categories: ["assault carbine"] },
  { name: "Submachine guns", categories: ["smg"] },
  { name: "Marksman rifles", categories: ["marksman rifle"] },
  { name: "Bolt-action rifles", categories: ["sniper rifle"] },
  { name: "Machine guns", categories: ["machinegun"] },
  { name: "Shotguns", categories: ["shotgun"] },
  { name: "Pistols", categories: ["handgun", "revolver"] },
] as const;

export type WeaponClass = (typeof WEAPON_CLASSES)[number]["name"];

export interface BestBuildWeapon {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  gridImageLink: string | null;
  caliber: string | null;
  weaponClass: WeaponClass;
}

export interface BestBuildPart {
  slot: string;
  name: string;
  slug: string | null;
  /** Comes with the weapon's default preset, so it isn't bought separately. */
  withWeapon: boolean;
  priceRUB: number | null;
  source: PriceSource | null;
  traderName: string | null;
}

export interface BestBuild {
  kind: BestBuildKind;
  ergonomics: number | null;
  recoilVertical: number | null;
  recoilHorizontal: number | null;
  weight: number;
  costRUB: number | null;
  parts: BestBuildPart[];
  /** Opens the build in the gun builder, ready to import. */
  shareHref: string;
}

export interface WeaponBestBuilds {
  weapon: BestBuildWeapon;
  gameMode: GameMode;
  builds: BestBuild[];
}

function weaponClass(categories: readonly string[]): WeaponClass | null {
  for (const entry of WEAPON_CLASSES) {
    if (entry.categories.some((category) => categories.includes(category))) return entry.name;
  }
  return null;
}

/** Weapons with a best-build page: real firearms in one of the listed classes, with a slug. */
export async function listBestBuildWeapons(gameMode: GameMode): Promise<BestBuildWeapon[]> {
  const [guns, lookup, facets] = await Promise.all([getGunList(gameMode), getGunPartLookup(gameMode), getItemFacets(gameMode)]);
  return guns.flatMap((gun): BestBuildWeapon[] => {
    const item = lookup.get(gun.id);
    const slug = item?.normalizedName;
    const facet = facets.byId.get(gun.id);
    const kind = facet ? weaponClass(facet.categories) : null;
    if (!item || !slug || !isItemSlug(slug) || !kind || item.slots.length === 0) return [];
    return [
      {
        id: gun.id,
        slug,
        name: gun.name,
        shortName: gun.shortName,
        gridImageLink: gun.gridImageLink,
        caliber: formatCaliber(item.caliber),
        weaponClass: kind,
      },
    ];
  });
}

function partsOf(root: BuildNode, lookup: PartLookup, shopping: ReturnType<typeof buildShoppingList>): BestBuildPart[] {
  const rows = new Map(shopping.rows.map((row) => [row.itemId, row]));
  const parts: BestBuildPart[] = [];
  const walk = (node: BuildNode, path: string[]) => {
    for (const [slotId, child] of Object.entries(node.slots)) {
      const childPath = [...path, slotId];
      const item = lookup.get(child.itemId);
      const row = rows.get(child.itemId);
      const slug = item?.normalizedName && isItemSlug(item.normalizedName) ? item.normalizedName : null;
      parts.push({
        slot: slotLabel(root, lookup, childPath),
        name: item?.name ?? child.itemId,
        slug,
        withWeapon: Boolean(row && row.count === 0 && row.withWeapon > 0),
        priceRUB: row?.unitPriceRUB ?? null,
        source: row?.source ?? null,
        traderName: row?.traderName ?? null,
      });
      walk(child, childPath);
    }
  };
  walk(root, []);
  return parts;
}

const BUILD_NAMES: Record<BestBuildKind, string> = {
  preset: "Factory preset",
  recoil: "Lowest recoil",
  ergonomics: "Max ergonomics",
};

async function describe(
  kind: BestBuildKind,
  weapon: BestBuildWeapon,
  root: BuildNode,
  lookup: PartLookup,
  pricing: Parameters<typeof computeStats>[4]
): Promise<BestBuild> {
  const stats = computeStats(root, lookup, BEST_BUILD_PRICES, null, pricing);
  const shopping = buildShoppingList(root, lookup, BEST_BUILD_PRICES, true, pricing);
  const name = `${BUILD_NAMES[kind]} ${weapon.shortName}`;
  const payload = await encodeBuildSharePayload({ id: "best", name, weaponId: weapon.id, root, createdAt: 0, updatedAt: 0 });
  return {
    kind,
    ergonomics: stats.ergonomics,
    recoilVertical: stats.recoilVertical,
    recoilHorizontal: stats.recoilHorizontal,
    weight: stats.weight,
    costRUB: stats.costRUB,
    parts: partsOf(root, lookup, shopping),
    shareHref: `/gun-builder/share/${slugifyBuildName(name)}#b=${payload}`,
  };
}

export class OptimizerBusyError extends Error {
  constructor() {
    super("The optimiser is busy.");
    this.name = "OptimizerBusyError";
  }
}

async function computeBestBuilds(gameMode: GameMode, weapon: BestBuildWeapon, signal?: AbortSignal): Promise<WeaponBestBuilds> {
  const lookup = await getGunPartLookup(gameMode);
  const presetId = lookup.get(weapon.id)?.defaultPresetId;
  const contents = presetId ? await getPreset(gameMode, presetId) : null;
  const preset = presetParts(weapon.id, contents, lookup);
  const pricing = { limits: null, preset };
  const start: BuildNode = contents ? reconstructPresetTree(weapon.id, contents, lookup) : { itemId: weapon.id, slots: {} };
  const builds: BestBuild[] = [];
  if (contents) builds.push(await describe("preset", weapon, start, lookup, pricing));
  for (const goal of ["recoil", "ergonomics"] as const) {
    if (!tryAcquireOptimizerSlot()) throw new OptimizerBusyError();
    try {
      const result = await optimizeBuild(
        start,
        lookup,
        { goal, priceSources: BEST_BUILD_PRICES, ...pricing, replaceExisting: true, allowUnpriced: false, ammoId: null },
        { signal }
      );
      builds.push(await describe(goal, weapon, result.root, lookup, pricing));
    } finally {
      releaseOptimizerSlot();
    }
  }
  return { weapon, gameMode, builds };
}

const CACHE_TTL_MS = 60 * 60_000;
const MAX_CACHED = 400;
const cache = new Map<string, { at: number; lookup: PartLookup; value: Promise<WeaponBestBuilds> }>();

/**
 * A weapon's factory preset, lowest-recoil and max-ergonomics builds. Results are kept for an
 * hour per instance, and recomputed sooner when the part data changes.
 */
export async function getWeaponBestBuilds(
  gameMode: GameMode,
  slug: string,
  signal?: AbortSignal
): Promise<WeaponBestBuilds | null> {
  const weapon = (await listBestBuildWeapons(gameMode)).find((entry) => entry.slug === slug);
  if (!weapon) return null;
  const lookup = await getGunPartLookup(gameMode);
  const key = `${gameMode}/${slug}`;
  const cached = cache.get(key);
  if (cached && cached.lookup === lookup && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const value = computeBestBuilds(gameMode, weapon, signal);
  cache.set(key, { at: Date.now(), lookup, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return value;
}
