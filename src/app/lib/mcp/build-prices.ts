import type { BuildSource, PartLookup } from "@/app/lib/builds/resolve";
import { hasTraderLimits, withTraderLimits, type TraderLimits } from "@/app/lib/builds/price";
import type { PriceSources } from "@/app/lib/types/gunBuilder";
import { InputError, type GameMode, type Read } from "./context";
import { loadBuildSource } from "./sources";

// Gun-builder price settings: which sources count and the trader loyalty levels the player has.

export interface PriceInput extends PriceSources {
  maxTraderLevel?: number;
  traderLevels?: Record<string, number>;
}

export interface BuildPricing {
  data: BuildSource;
  sources: PriceSources;
  limits: TraderLimits | null;
}

const MAX_LIMITED_LOOKUPS = 16;
const limitedLookups = new WeakMap<PartLookup, Map<string, PartLookup>>();

function traderNames(lookup: PartLookup) {
  const names = new Map<string, string>();
  for (const item of lookup.values()) {
    for (const offer of item.traderOffers ?? []) names.set(offer.trader.toLowerCase(), offer.trader);
  }
  return names;
}

function parseLimits(input: PriceInput, lookup: PartLookup): TraderLimits | null {
  const entries = Object.entries(input.traderLevels ?? {});
  if (input.maxTraderLevel === undefined && entries.length === 0) return null;
  const known = traderNames(lookup);
  const levels: Record<string, number> = {};
  for (const [name, level] of entries) {
    const key = name.trim().toLowerCase();
    if (!known.has(key)) {
      throw new InputError(
        `traderLevels has an unknown trader "${name}". Traders: ${[...known.values()].sort().join(", ")}.`
      );
    }
    levels[key] = level;
  }
  return { maxLevel: input.maxTraderLevel ?? null, levels };
}

/** The part lookup with trader prices limited to the offers the player can use. */
function limitLookup(lookup: PartLookup, limits: TraderLimits): PartLookup {
  let byKey = limitedLookups.get(lookup);
  if (!byKey) {
    byKey = new Map();
    limitedLookups.set(lookup, byKey);
  }
  const key = JSON.stringify([limits.maxLevel, Object.entries(limits.levels ?? {}).sort()]);
  const cached = byKey.get(key);
  if (cached) return cached;
  const limited = new Map(Array.from(lookup, ([id, item]) => [id, withTraderLimits(item, limits)]));
  if (byKey.size >= MAX_LIMITED_LOOKUPS) byKey.delete(byKey.keys().next().value!);
  byKey.set(key, limited);
  return limited;
}

/** Loads the build data with prices from the chosen sources at the player's trader levels. */
export async function loadBuildPricing(read: Read, gameMode: GameMode, input: PriceInput): Promise<BuildPricing> {
  const source = await loadBuildSource(read, gameMode);
  const sources = { traders: input.traders, flea: input.flea };
  const limits = parseLimits(input, source.lookup);
  if (!hasTraderLimits(limits)) return { data: source, sources, limits: null };
  return {
    data: {
      ...source,
      lookup: limitLookup(source.lookup, limits),
      loadAmmo: async (ids) => (await source.loadAmmo(ids)).map((ammo) => withTraderLimits(ammo, limits)),
    },
    sources,
    limits,
  };
}
