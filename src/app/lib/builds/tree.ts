import type { BuildNode } from "@/app/lib/types/gunBuilder";

/** Every item id installed in the tree (weapon + all mods), depth-first. */
export function collectItemIds(node: BuildNode): string[] {
  return [
    node.itemId,
    ...Object.values(node.slots).flatMap((child) => collectItemIds(child)),
  ];
}

/** Every slot id that currently holds a mod, depth-first. */
export function collectOccupiedSlotIds(node: BuildNode): string[] {
  return [
    ...Object.keys(node.slots),
    ...Object.values(node.slots).flatMap((child) =>
      collectOccupiedSlotIds(child)
    ),
  ];
}
