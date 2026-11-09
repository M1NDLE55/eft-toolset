import type { BuildNode, GunItem } from "@/app/lib/types/gunBuilder";
import type { ItemLookup } from "./stats";

export interface InstalledParts {
  items: string[];
  itemSet: Set<string>;
  slots: Set<string>;
}

export function installedOutside(root: BuildNode, excluded: BuildNode | undefined): InstalledParts {
  const items: string[] = [root.itemId];
  const slots = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const [slotId, child] of Object.entries(node.slots)) {
      if (child === excluded) continue;
      slots.add(slotId);
      items.push(child.itemId);
      stack.push(child);
    }
  }
  return { items, itemSet: new Set(items), slots };
}

export function conflictReason(
  candidate: GunItem,
  slotId: string,
  installed: InstalledParts,
  lookup: ItemLookup
) {
  const own = candidate.conflictingItemIds.find((id) => installed.itemSet.has(id));
  if (own) return `Conflicts with ${lookup.get(own)?.shortName ?? "an installed part"}`;
  for (const id of installed.items) {
    const other = lookup.get(id);
    if (!other) continue;
    if (other.conflictingItemIds.includes(candidate.id)) return `Conflicts with ${other.shortName}`;
    if (other.conflictingSlotIds.includes(slotId)) return `Blocked by ${other.shortName}`;
  }
  if (candidate.conflictingSlotIds.some((id) => installed.slots.has(id))) {
    return "Blocks an occupied slot";
  }
  return null;
}

export interface PlacedPart {
  node: BuildNode;
  path: string[];
  slotId: string | null;
}

export interface BuildConflict {
  kind: "item" | "slot";
  source: PlacedPart;
  other: PlacedPart;
  slotId: string | null;
}

export function placedParts(root: BuildNode): PlacedPart[] {
  const result: PlacedPart[] = [];
  const stack: PlacedPart[] = [{ node: root, path: [], slotId: null }];
  while (stack.length > 0) {
    const entry = stack.pop()!;
    result.push(entry);
    for (const [slotId, child] of Object.entries(entry.node.slots)) {
      stack.push({ node: child, path: [...entry.path, slotId], slotId });
    }
  }
  return result;
}

export function findConflicts(root: BuildNode, lookup: ItemLookup): BuildConflict[] {
  const parts = placedParts(root);
  const byItem = new Map<string, PlacedPart[]>();
  const bySlot = new Map<string, PlacedPart[]>();
  for (const part of parts) {
    byItem.set(part.node.itemId, [...(byItem.get(part.node.itemId) ?? []), part]);
    if (part.slotId) bySlot.set(part.slotId, [...(bySlot.get(part.slotId) ?? []), part]);
  }
  const conflicts: BuildConflict[] = [];
  const seen = new Set<string>();
  const add = (conflict: BuildConflict) => {
    const ends = [conflict.source.path.join("/"), conflict.other.path.join("/")];
    const key = `${conflict.kind}:${conflict.kind === "item" ? ends.sort().join("|") : ends.join("|")}`;
    if (seen.has(key)) return;
    seen.add(key);
    conflicts.push(conflict);
  };
  for (const part of parts) {
    const item = lookup.get(part.node.itemId);
    if (!item) continue;
    for (const id of item.conflictingItemIds) {
      for (const other of byItem.get(id) ?? []) {
        if (other !== part) add({ kind: "item", source: part, other, slotId: null });
      }
    }
    for (const slotId of item.conflictingSlotIds) {
      for (const other of bySlot.get(slotId) ?? []) {
        if (other !== part) add({ kind: "slot", source: part, other, slotId });
      }
    }
  }
  return conflicts;
}
