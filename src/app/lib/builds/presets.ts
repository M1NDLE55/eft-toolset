import type {
  BuildItemData,
  BuildNode,
  PresetContents,
} from "@/app/lib/types/gunBuilder";

function tryPlace(
  node: BuildNode,
  itemId: string,
  data: Map<string, BuildItemData>
): boolean {
  const parent = data.get(node.itemId);
  if (!parent) return false;

  const openSlot = parent.slots.find(
    (slot) => !node.slots[slot.id] && slot.allowedItemIds.includes(itemId)
  );

  if (openSlot) {
    node.slots[openSlot.id] = { itemId, slots: {} };
    return true;
  }

  for (const child of Object.values(node.slots)) {
    if (tryPlace(child, itemId, data)) return true;
  }

  return false;
}

export function reconstructPresetTree(
  weaponId: string,
  preset: PresetContents,
  data: Map<string, BuildItemData>
): BuildNode {
  const root: BuildNode = { itemId: preset.baseItemId ?? weaponId, slots: {} };
  const pending = preset.itemIds.filter((id) => id !== root.itemId);

  for (let pass = 0; pass < pending.length; pass += 1) {
    let placedAny = false;

    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const itemId = pending[index];
      if (tryPlace(root, itemId, data)) {
        pending.splice(index, 1);
        placedAny = true;
      }
    }

    if (!placedAny) break;
  }

  if (pending.length > 0) {
    console.warn("Preset items could not be placed:", pending);
  }

  return root;
}
