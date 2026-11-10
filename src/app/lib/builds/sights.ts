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

/** Installed aiming parts, outermost first, and the kinds (name ids) of every slot the build has. */
function installedSights(root: BuildNode, lookup: ItemLookup) {
  const sights: (SightCheck["sights"][number] & { slotNameId: string })[] = [];
  const slotKinds = new Set<string>();
  const walk = (node: BuildNode, path: string[]) => {
    const item = lookup.get(node.itemId);
    if (!isDetailed(item)) return;
    for (const slot of item.slots) {
      slotKinds.add(slot.nameId);
      const child = childAt(node, slot.id);
      if (!child) continue;
      const childPath = [...path, slot.id];
      const role = sightRole(lookup.get(child.itemId), slot.nameId);
      if (role) sights.push({ role, itemId: child.itemId, path: childPath, slotNameId: slot.nameId });
      walk(child, childPath);
    }
  };
  walk(root, []);
  return { sights, slotKinds };
}

export type MissingSight = "rear sight" | "front sight" | "optic";

export interface SightCheck {
  /** Installed aiming parts, outermost first. */
  sights: { role: SightRole; itemId: string; path: string[] }[];
  usable: boolean;
  /** Aiming parts the factory gun has that the build lost, when it has no optic. */
  missing: MissingSight[];
  /** The factory gun's aiming parts that the build lacks, for the message. */
  factorySights: string[];
}

/**
 * Whether a build can still aim, judged against the weapon's factory (default) preset, which
 * is known to work. Sights built into a weapon, barrel, receiver, or dust cover are not parts,
 * so the data can't show them; what it can show is a build losing a sight part the factory gun
 * has. An optic always passes. Otherwise the build needs every iron sight role the factory gun
 * fills with a part; a factory gun that aims only through an optic needs an optic or some iron
 * sight. A factory sight counts as lost only while the build still has a slot of the kind it
 * sat in, filled with something else or empty: a part without that slot, such as a sawn-off
 * barrel with no front sight slot, may have the sight built in. Without a factory preset, or
 * when it has no sight parts (built-in sights), there is nothing to judge and the build passes.
 */
export function checkSights(root: BuildNode, lookup: ItemLookup, factory: BuildNode | null): SightCheck {
  const { sights: found, slotKinds } = installedSights(root, lookup);
  const sights = found.map(({ role, itemId, path }) => ({ role, itemId, path }));
  const pass = { sights, usable: true, missing: [], factorySights: [] };
  const has = (role: SightRole) => sights.some((sight) => sight.role === role);
  if (!factory || has("optic")) return pass;
  const reference = installedSights(factory, lookup).sights.filter((sight) => slotKinds.has(sight.slotNameId));
  const iron = reference.filter((sight) => sight.role !== "optic");
  const lost =
    iron.length > 0
      ? iron.filter((sight) => !has(sight.role))
      : sights.length === 0
        ? reference.filter((sight) => sight.role === "optic")
        : [];
  if (lost.length === 0) return pass;
  const labels: Record<SightRole, MissingSight> = { optic: "optic", rear: "rear sight", front: "front sight" };
  return {
    sights,
    usable: false,
    missing: (["rear sight", "front sight", "optic"] as const).filter((kind) =>
      lost.some((sight) => labels[sight.role] === kind)
    ),
    factorySights: [...new Set(lost.map((sight) => sight.itemId))],
  };
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
