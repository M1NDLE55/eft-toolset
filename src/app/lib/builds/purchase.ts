import type { BuildNode, GunItem, PresetContents, PriceSources } from "@/app/lib/types/gunBuilder";
import { reconstructPresetTree } from "./presets";
import { bestOffer, effectivePrice, priceChoice, traderQuote, type PriceChoice, type TraderLimits } from "./price";
import type { ItemLookup } from "./stats";

export interface PresetParts {
  /** Item id → count. */
  counts: ReadonlyMap<string, number>;
  /** Where the preset installs each part, as placementKey(slot path, itemId). */
  placements: ReadonlySet<string>;
  /** Slot paths (pathKey) of preset items that have parts attached. */
  branches: ReadonlySet<string>;
}

export interface PurchaseContext {
  limits?: TraderLimits | null;
  preset?: PresetParts | null;
}

export function placementKey(path: readonly string[], itemId: string) {
  return `${pathKey(path)}:${itemId}`;
}

export function pathKey(path: readonly string[]) {
  return path.join("/");
}

export function presetParts(
  weaponId: string,
  contents: PresetContents | null | undefined,
  lookup: ItemLookup
): PresetParts | null {
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
  const placements = new Set<string>();
  const branches = new Set<string>();
  const place = (node: BuildNode, path: string[]) => {
    for (const [slotId, child] of Object.entries(node.slots)) {
      branches.add(pathKey(path));
      placements.add(placementKey([...path, slotId], child.itemId));
      place(child, [...path, slotId]);
    }
  };
  place(reconstructPresetTree(weaponId, contents, lookup), []);
  return { counts, placements, branches };
}

/** The cheapest allowed way to buy the weapon bare, and as its default preset. */
export function weaponChoices(weapon: GunItem, sources: PriceSources, limits: TraderLimits | null) {
  const pick = (asPreset: boolean): PriceChoice | null => {
    const traderOffers = weapon.traderOffers?.filter((offer) => Boolean(offer.preset) === asPreset);
    const barterOffers = weapon.barterOffers?.filter((offer) => Boolean(offer.preset) === asPreset);
    return priceChoice(
      {
        traderPriceRUB: traderQuote(weapon, limits, asPreset)?.priceRUB ?? null,
        traderOffers,
        // The flea market sells weapons as their default preset.
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
  weapon: PriceChoice | null;
  asPreset: boolean;
  /** Slot paths (pathKey) of the parts that come with the preset. */
  owned: ReadonlySet<string>;
  /** Preset parts the build doesn't use, kept with no resale value counted: item id → count. */
  spare: ReadonlyMap<string, number>;
  costRUB: number;
  pricedCount: number;
  /** Known items, the weapon included, that need buying but have no price. */
  missingCount: number;
}

interface Placed {
  node: BuildNode;
  path: string[];
}

function nodesOf(root: BuildNode) {
  const nodes: Placed[] = [];
  const stack: Placed[] = [{ node: root, path: [] }];
  while (stack.length > 0) {
    const entry = stack.pop()!;
    nodes.push(entry);
    const children = Object.entries(entry.node.slots).map(([slotId, node]) => ({ node, path: [...entry.path, slotId] }));
    stack.push(...children.reverse());
  }
  return nodes;
}

function priceWith(
  nodes: readonly Placed[],
  lookup: ItemLookup,
  sources: PriceSources,
  weapon: PriceChoice | null,
  preset: PresetParts | null
): BuildPurchase {
  const remaining = new Map(preset?.counts ?? []);
  const owned = new Set<string>();
  let costRUB = 0;
  let pricedCount = 0;
  let missingCount = 0;
  for (const { node, path } of nodes) {
    const root = path.length === 0;
    if (!root) {
      const left = remaining.get(node.itemId) ?? 0;
      if (left > 0) {
        remaining.set(node.itemId, left - 1);
        owned.add(pathKey(path));
        continue;
      }
    }
    const item = lookup.get(node.itemId);
    if (!item) continue;
    const price = root ? (weapon?.priceRUB ?? null) : effectivePrice(item, sources);
    if (price === null) missingCount += 1;
    else {
      costRUB += price;
      pricedCount += 1;
    }
  }
  const spare = new Map([...remaining].filter(([, count]) => count > 0));
  return { weapon, asPreset: preset !== null, owned, spare, costRUB, pricedCount, missingCount };
}

/** Prefer fewer unpriced items, then lower cost. */
export function planPurchase(
  root: BuildNode,
  lookup: ItemLookup,
  sources: PriceSources,
  { limits = null, preset = null }: PurchaseContext = {}
): BuildPurchase {
  const nodes = nodesOf(root);
  const weapon = lookup.get(root.itemId);
  if (!weapon || !preset) {
    return priceWith(nodes, lookup, sources, weapon ? priceChoice(weapon, sources, limits) : null, null);
  }
  const choices = weaponChoices(weapon, sources, limits);
  const bare = priceWith(nodes, lookup, sources, choices.bare, null);
  if (!choices.preset) return bare;
  const asPreset = priceWith(nodes, lookup, sources, choices.preset, preset);
  const better =
    asPreset.missingCount !== bare.missingCount
      ? asPreset.missingCount < bare.missingCount
      : asPreset.costRUB <= bare.costRUB;
  return better ? asPreset : bare;
}
