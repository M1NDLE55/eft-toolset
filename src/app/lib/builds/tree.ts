import type { BuildNode } from "@/app/lib/types/gunBuilder";

export function collectItemIds(node: BuildNode): string[] {
  return [
    node.itemId,
    ...Object.values(node.slots).flatMap((child) => collectItemIds(child)),
  ];
}

export function collectOccupiedSlotIds(node: BuildNode): string[] {
  return [
    ...Object.keys(node.slots),
    ...Object.values(node.slots).flatMap((child) =>
      collectOccupiedSlotIds(child)
    ),
  ];
}
