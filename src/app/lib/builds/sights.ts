import type { BuildNode, GunItem } from "@/app/lib/types/gunBuilder";
import { isDetailed, type ItemLookup } from "./stats";
import { childAt } from "./tree";

// What a build aims with, and whether that is enough to aim at all.

export type SightRole = "optic" | "rear" | "front";

/** An installed part's aiming role: iron sights count as front or rear by the slot they sit in. */
export function sightRole(item: GunItem | undefined, slotNameId: string): SightRole | null {
  switch (item?.sight) {
    case "optic":
      return "optic";
    case "iron":
      return /front/i.test(slotNameId) ? "front" : "rear";
    case "front":
      return "front";
    default:
      return null;
  }
}

export function isMagazineSlot(slot: { nameId: string }) {
  return slot.nameId.startsWith("mod_magazine");
}

const capabilityCache = new WeakMap<ItemLookup, Map<string, ReadonlySet<SightRole>>>();

/** The sight roles any compatible part could fill on a weapon. Built-in sights have no part, so they don't count. */
export function sightCapabilities(weaponId: string, lookup: ItemLookup): ReadonlySet<SightRole> {
  let byWeapon = capabilityCache.get(lookup);
  if (!byWeapon) {
    byWeapon = new Map();
    capabilityCache.set(lookup, byWeapon);
  }
  const cached = byWeapon.get(weaponId);
  if (cached) return cached;
  const roles = new Set<SightRole>();
  const seen = new Set<string>([weaponId]);
  const queue = [weaponId];
  while (queue.length > 0 && roles.size < 3) {
    const item = lookup.get(queue.shift()!);
    if (!isDetailed(item)) continue;
    for (const slot of item.slots) {
      for (const id of slot.allowedItemIds) {
        const role = sightRole(lookup.get(id), slot.nameId);
        if (role) roles.add(role);
        if (!seen.has(id)) {
          seen.add(id);
          queue.push(id);
        }
      }
    }
  }
  byWeapon.set(weaponId, roles);
  return roles;
}

export interface SightCheck {
  /** Installed aiming parts, outermost first. */
  sights: { role: SightRole; itemId: string; path: string[] }[];
  usable: boolean;
  /** Iron sights the weapon takes but lacks, when there is no optic. */
  missing: ("rear sight" | "front sight")[];
}

/**
 * Whether a build can aim: an optic, or every iron sight the weapon takes. Weapons whose
 * iron sights are built in take no sight parts, so they always pass.
 */
export function checkSights(root: BuildNode, lookup: ItemLookup): SightCheck {
  const sights: SightCheck["sights"] = [];
  const walk = (node: BuildNode, path: string[]) => {
    const item = lookup.get(node.itemId);
    if (!isDetailed(item)) return;
    for (const slot of item.slots) {
      const child = childAt(node, slot.id);
      if (!child) continue;
      const childPath = [...path, slot.id];
      const role = sightRole(lookup.get(child.itemId), slot.nameId);
      if (role) sights.push({ role, itemId: child.itemId, path: childPath });
      walk(child, childPath);
    }
  };
  walk(root, []);
  const has = (role: SightRole) => sights.some((sight) => sight.role === role);
  if (has("optic")) return { sights, usable: true, missing: [] };
  const capable = sightCapabilities(root.itemId, lookup);
  const missing: SightCheck["missing"] = [];
  if (capable.has("rear") && !has("rear")) missing.push("rear sight");
  if (capable.has("front") && !has("front")) missing.push("front sight");
  return { sights, usable: missing.length === 0, missing };
}

/** The largest magazine installed, as a capacity. */
export function installedMagazineCapacity(root: BuildNode, lookup: ItemLookup): number | null {
  let best: number | null = null;
  const walk = (node: BuildNode) => {
    const item = lookup.get(node.itemId);
    if (!isDetailed(item)) return;
    for (const slot of item.slots) {
      const child = childAt(node, slot.id);
      if (!child) continue;
      const capacity = lookup.get(child.itemId)?.capacity;
      if (isMagazineSlot(slot) && typeof capacity === "number") best = Math.max(best ?? 0, capacity);
      walk(child);
    }
  };
  walk(root);
  return best;
}
