import type { BuildNode, GunItem, PresetContents, PriceSources } from "@/app/lib/types/gunBuilder";
import { bestOffer, effectivePrice, priceChoice, type PriceChoice, type TraderLimits } from "./price";
import type { ItemLookup } from "./stats";

// How a build is bought. A weapon bought as its default preset (a trader's preset offer, a
// preset barter, or the flea market, whose weapon prices are preset prices) comes with the
// preset's parts, so those are owned and cost nothing. A bare weapon comes with nothing.

/** The parts a weapon's default preset comes with: item id → count. */
export type PresetParts = ReadonlyMap<string, number>;

/** What pricing a build needs beyond its price sources. */
export interface PurchaseContext {
  limits?: TraderLimits | null;
  /** The weapon's default preset parts; without them every part is priced. */
  preset?: PresetParts | null;
}

export function presetParts(weaponId: string, contents: PresetContents | null | undefined): PresetParts | null {
  if (!contents || (contents.baseItemId !== null && contents.baseItemId !== weaponId)) return null;
  const counts = new Map<string, number>();
  let weaponSeen = false;
  for (const id of contents.itemIds) {
    if (id === weaponId && !weaponSeen) {
      weaponSeen = true;
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** The cheapest allowed way to buy the weapon bare, and as its default preset. */
export function weaponChoices(weapon: GunItem, sources: PriceSources, limits: TraderLimits | null) {
  const pick = (asPreset: boolean): PriceChoice | null => {
    const traderOffers = weapon.traderOffers?.filter((offer) => Boolean(offer.preset) === asPreset);
    const barterOffers = weapon.barterOffers?.filter((offer) => Boolean(offer.preset) === asPreset);
    return priceChoice(
      {
        // Items without offer lists only have a price for the weapon itself.
        traderPriceRUB: traderOffers
          ? (bestOffer(traderOffers, limits)?.priceRUB ?? null)
          : asPreset
            ? null
            : weapon.traderPriceRUB,
        traderOffers,
        fleaPriceRUB: asPreset ? weapon.fleaPriceRUB : null,
        barterPriceRUB: barterOffers
          ? (bestOffer(barterOffers, limits)?.priceRUB ?? null)
          : asPreset
            ? null
            : (weapon.barterPriceRUB ?? null),
        barterOffers,
      },
      sources,
      limits
    );
  };
  return { bare: pick(false), preset: pick(true) };
}

export interface BuildPurchase {
  /** How the weapon is bought; null when it has no price. */
  weapon: PriceChoice | null;
  /** The weapon is bought as its default preset, so the preset's parts are owned. */
  asPreset: boolean;
  /** Parts the preset comes with, which aren't bought. */
  owned: ReadonlySet<BuildNode>;
  /** Preset parts the build doesn't use, kept with no resale value counted: item id → count. */
  spare: ReadonlyMap<string, number>;
  costRUB: number;
  pricedCount: number;
  /** Known items, the weapon included, that need buying but have no price. */
  missingCount: number;
}

function nodesOf(root: BuildNode) {
  const nodes: BuildNode[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    nodes.push(node);
    stack.push(...Object.values(node.slots).reverse());
  }
  return nodes;
}

function priceWith(
  root: BuildNode,
  nodes: readonly BuildNode[],
  lookup: ItemLookup,
  sources: PriceSources,
  weapon: PriceChoice | null,
  preset: PresetParts | null
): BuildPurchase {
  const remaining = new Map(preset ?? []);
  const owned = new Set<BuildNode>();
  let costRUB = 0;
  let pricedCount = 0;
  let missingCount = 0;
  for (const node of nodes) {
    const item = lookup.get(node.itemId);
    if (node !== root) {
      const left = remaining.get(node.itemId) ?? 0;
      if (left > 0) {
        remaining.set(node.itemId, left - 1);
        owned.add(node);
        continue;
      }
    }
    if (!item) continue;
    const price = node === root ? (weapon?.priceRUB ?? null) : effectivePrice(item, sources);
    if (price === null) missingCount += 1;
    else {
      costRUB += price;
      pricedCount += 1;
    }
  }
  const spare = new Map([...remaining].filter(([, count]) => count > 0));
  return { weapon, asPreset: preset !== null, owned, spare, costRUB, pricedCount, missingCount };
}

/**
 * The cheapest way to buy the build: the bare weapon and every part, or the weapon's default
 * preset and only the parts it doesn't come with. Fewer unpriced items wins, then the lower cost.
 */
export function planPurchase(
  root: BuildNode,
  lookup: ItemLookup,
  sources: PriceSources,
  { limits = null, preset = null }: PurchaseContext = {}
): BuildPurchase {
  const nodes = nodesOf(root);
  const weapon = lookup.get(root.itemId);
  if (!weapon || !preset) {
    return priceWith(root, nodes, lookup, sources, weapon ? priceChoice(weapon, sources, limits) : null, null);
  }
  const choices = weaponChoices(weapon, sources, limits);
  const bare = priceWith(root, nodes, lookup, sources, choices.bare, null);
  if (!choices.preset) return bare;
  const asPreset = priceWith(root, nodes, lookup, sources, choices.preset, preset);
  const better =
    asPreset.missingCount !== bare.missingCount
      ? asPreset.missingCount < bare.missingCount
      : asPreset.costRUB <= bare.costRUB;
  return better ? asPreset : bare;
}
