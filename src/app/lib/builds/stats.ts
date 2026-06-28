import type {
  BuildItemData,
  BuildNode,
  PriceSources,
} from "@/app/lib/types/gunBuilder";
import { collectItemIds } from "./tree";
import { effectivePrice } from "./price";

export interface BuildStats {
  ergonomics: number | null;
  recoilVertical: number | null;
  recoilHorizontal: number | null;
  weight: number;
  costRUB: number | null;
  costMissingCount: number;
  missingRequiredSlots: string[];
  installedItemIds: string[];
}

function missingRequired(
  node: BuildNode,
  data: Map<string, BuildItemData>,
  labelPrefix = ""
): string[] {
  const item = data.get(node.itemId);
  if (!item) return [];

  return item.slots.flatMap((slot) => {
    const label = labelPrefix ? `${labelPrefix} / ${slot.name}` : slot.name;
    const child = node.slots[slot.id];
    const own = slot.required && !child ? [label] : [];
    return child ? [...own, ...missingRequired(child, data, label)] : own;
  });
}

export function computeStats(
  root: BuildNode,
  data: Map<string, BuildItemData>,
  sources: PriceSources
): BuildStats {
  const installedItemIds = collectItemIds(root);
  const items = installedItemIds
    .map((id) => data.get(id))
    .filter((item): item is BuildItemData => Boolean(item));
  const weapon = data.get(root.itemId);

  if (!weapon) {
    return {
      ergonomics: null,
      recoilVertical: null,
      recoilHorizontal: null,
      weight: 0,
      costRUB: null,
      costMissingCount: 0,
      missingRequiredSlots: [],
      installedItemIds,
    };
  }

  const modItems = items.filter((item) => item.id !== root.itemId);
  const ergonomics =
    weapon.ergonomics +
    modItems.reduce((total, item) => total + item.ergonomics, 0);
  const recoilModifier = modItems.reduce(
    (total, item) => total + item.recoilModifier,
    0
  );
  const weight = items.reduce((total, item) => total + item.weight, 0);
  const knownPrices = items
    .map((item) => effectivePrice(item, sources))
    .filter((price): price is number => typeof price === "number");

  return {
    ergonomics,
    recoilVertical:
      typeof weapon.recoilVertical === "number"
        ? weapon.recoilVertical * (1 + recoilModifier)
        : null,
    recoilHorizontal:
      typeof weapon.recoilHorizontal === "number"
        ? weapon.recoilHorizontal * (1 + recoilModifier)
        : null,
    weight,
    costRUB: knownPrices.length
      ? knownPrices.reduce((total, price) => total + price, 0)
      : null,
    costMissingCount: items.length - knownPrices.length,
    missingRequiredSlots: missingRequired(root, data),
    installedItemIds,
  };
}
