import type {
  BuildItemData,
  BuildNode,
  GunItem,
  ModSlotDef,
  PriceSources,
} from "@/app/lib/types/gunBuilder";
import { childAt } from "./tree";
import { effectivePrice } from "./price";

export type ItemLookup = ReadonlyMap<string, GunItem>;

export function isDetailed(item: GunItem | undefined): item is BuildItemData {
  return Boolean(item && "slots" in item);
}

export interface MissingSlot {
  label: string;
  parentPath: string[];
  slot: ModSlotDef;
}

export interface BaseStats {
  ergonomics: number;
  recoilVertical: number | null;
  recoilHorizontal: number | null;
  weight: number;
}

export interface BuildStats {
  ergonomics: number | null;
  recoilVertical: number | null;
  recoilHorizontal: number | null;
  weight: number;
  costRUB: number | null;
  costMissingCount: number;
  partCount: number;
  unknownCount: number;
  missingRequired: MissingSlot[];
  base: BaseStats | null;
}

function findMissing(
  node: BuildNode,
  lookup: ItemLookup,
  path: string[],
  prefix: string,
  result: MissingSlot[]
) {
  const item = lookup.get(node.itemId);
  if (!isDetailed(item)) return;
  for (const slot of item.slots) {
    const label = prefix ? `${prefix} / ${slot.name}` : slot.name;
    const child = childAt(node, slot.id);
    if (child) findMissing(child, lookup, [...path, slot.id], label, result);
    else if (slot.required) result.push({ label, parentPath: path, slot });
  }
}

export function computeStats(
  root: BuildNode,
  lookup: ItemLookup,
  sources: PriceSources,
  ammo: { recoilModifier: number } | null = null
): BuildStats {
  const weapon = lookup.get(root.itemId);
  let ergonomics = weapon?.ergonomics ?? 0;
  let recoilModifier = ammo && Number.isFinite(ammo.recoilModifier) ? ammo.recoilModifier : 0;
  let weight = 0;
  let cost = 0;
  let priced = 0;
  let costMissingCount = 0;
  let partCount = 0;
  let unknownCount = 0;

  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    stack.push(...Object.values(node.slots));
    if (node !== root) partCount += 1;
    const item = lookup.get(node.itemId);
    if (!item) {
      unknownCount += 1;
      continue;
    }
    weight += item.weight;
    const price = effectivePrice(item, sources);
    if (price === null) costMissingCount += 1;
    else {
      cost += price;
      priced += 1;
    }
    if (node !== root) {
      ergonomics += item.ergonomics;
      recoilModifier += item.recoilModifier;
    }
  }

  const missingRequired: MissingSlot[] = [];
  findMissing(root, lookup, [], "", missingRequired);
  const detailed = isDetailed(weapon) ? weapon : null;
  const scale = (value: number | null | undefined) =>
    typeof value === "number" ? value * Math.max(0, 1 + recoilModifier) : null;

  return {
    ergonomics: weapon ? ergonomics : null,
    recoilVertical: scale(detailed?.recoilVertical),
    recoilHorizontal: scale(detailed?.recoilHorizontal),
    weight,
    costRUB: priced > 0 ? cost : null,
    costMissingCount,
    partCount,
    unknownCount,
    missingRequired,
    base: detailed
      ? {
          ergonomics: detailed.ergonomics,
          recoilVertical: detailed.recoilVertical,
          recoilHorizontal: detailed.recoilHorizontal,
          weight: detailed.weight,
        }
      : null,
  };
}
