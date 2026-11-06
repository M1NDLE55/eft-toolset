import type { BuildNode } from "@/app/lib/types/gunBuilder";
import { isDetailed, type ItemLookup } from "./stats";

export interface AmmoOptions {
  ids: string[];
  source: "magazine" | "weapon" | null;
  magazineId: string | null;
}

export function findMagazine(root: BuildNode, lookup: ItemLookup): string | null {
  const stack = Object.values(root.slots);
  while (stack.length > 0) {
    const node = stack.shift()!;
    const item = lookup.get(node.itemId);
    if (isDetailed(item) && !item.isWeapon && (item.allowedAmmoIds?.length ?? 0) > 0) return node.itemId;
    stack.push(...Object.values(node.slots));
  }
  return null;
}

export function ammoOptions(root: BuildNode, lookup: ItemLookup): AmmoOptions {
  const weapon = lookup.get(root.itemId);
  const weaponIds = isDetailed(weapon) ? (weapon.allowedAmmoIds ?? []) : [];
  const magazineId = findMagazine(root, lookup);
  const magazine = magazineId ? lookup.get(magazineId) : undefined;
  const magazineIds = isDetailed(magazine) ? (magazine.allowedAmmoIds ?? []) : [];
  if (magazineIds.length > 0) {
    const chamber = new Set(weaponIds);
    const shared = weaponIds.length > 0 ? magazineIds.filter((id) => chamber.has(id)) : magazineIds;
    if (shared.length > 0) return { ids: Array.from(new Set(shared)), source: "magazine", magazineId };
  }
  return { ids: Array.from(new Set(weaponIds)), source: weaponIds.length > 0 ? "weapon" : null, magazineId };
}

export function ammoFits(ammoId: string | null | undefined, options: AmmoOptions) {
  return Boolean(ammoId) && options.ids.includes(ammoId!);
}
