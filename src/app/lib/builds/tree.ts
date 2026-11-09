import type { BuildItemData, BuildNode } from "@/app/lib/types/gunBuilder";
import {
  MAX_BUILD_ID_LENGTH,
  MAX_BUILD_TREE_DEPTH,
  MAX_BUILD_TREE_NODES,
  MAX_SLOTS_PER_NODE,
} from "./limits";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidBuildId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_BUILD_ID_LENGTH &&
    ID_PATTERN.test(value)
  );
}

export function isBuildTree(value: unknown): value is BuildNode {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  let count = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    count += 1;
    if (
      count > MAX_BUILD_TREE_NODES ||
      depth > MAX_BUILD_TREE_DEPTH ||
      !node ||
      typeof node !== "object" ||
      Array.isArray(node)
    ) {
      return false;
    }
    const candidate = node as Partial<BuildNode>;
    if (
      !isValidBuildId(candidate.itemId) ||
      !candidate.slots ||
      typeof candidate.slots !== "object" ||
      Array.isArray(candidate.slots)
    ) {
      return false;
    }
    const entries = Object.entries(candidate.slots);
    if (entries.length > MAX_SLOTS_PER_NODE) return false;
    for (const [slotId, child] of entries) {
      if (!isValidBuildId(slotId)) return false;
      stack.push({ node: child, depth: depth + 1 });
    }
  }
  return true;
}

export function childAt(node: BuildNode, slotId: string): BuildNode | undefined {
  return Object.hasOwn(node.slots, slotId) ? node.slots[slotId] : undefined;
}

export function collectItemIds(node: BuildNode): string[] {
  const ids: string[] = [];
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    ids.push(current.itemId);
    stack.push(...Object.values(current.slots));
  }
  return ids;
}

export function countParts(node: BuildNode) {
  return collectItemIds(node).length - 1;
}

export function cloneTree(node: BuildNode): BuildNode {
  return {
    itemId: node.itemId,
    slots: Object.fromEntries(
      Object.entries(node.slots).map(([slotId, child]) => [slotId, cloneTree(child)])
    ),
  };
}

export function nodeAt(root: BuildNode, path: string[]): BuildNode | undefined {
  let current: BuildNode | undefined = root;
  for (const slotId of path) {
    if (!current) return undefined;
    current = childAt(current, slotId);
  }
  return current;
}

function updateAt(
  node: BuildNode,
  path: string[],
  updater: (node: BuildNode) => BuildNode
): BuildNode {
  if (path.length === 0) return updater(node);
  const [slotId, ...rest] = path;
  const child = childAt(node, slotId);
  if (!child) return node;
  return { ...node, slots: { ...node.slots, [slotId]: updateAt(child, rest, updater) } };
}

export function attachMod(
  root: BuildNode,
  parentPath: string[],
  slotId: string,
  child: BuildNode
): BuildNode {
  return updateAt(root, parentPath, (node) => ({
    ...node,
    slots: { ...node.slots, [slotId]: child },
  }));
}

export function removeMod(root: BuildNode, path: string[]): BuildNode {
  if (path.length === 0) return root;
  const slotId = path[path.length - 1];
  return updateAt(root, path.slice(0, -1), (node) => {
    const slots = { ...node.slots };
    delete slots[slotId];
    return { ...node, slots };
  });
}

export function carryOverChildren(
  previous: BuildNode,
  previousItem: BuildItemData | undefined,
  nextItem: BuildItemData
): BuildNode {
  const slots: Record<string, BuildNode> = {};
  const used = new Set<string>();
  for (const [slotId, child] of Object.entries(previous.slots)) {
    const nameId = previousItem?.slots.find((slot) => slot.id === slotId)?.nameId;
    const accepts = (slot: BuildItemData["slots"][number]) =>
      !used.has(slot.id) && slot.allowedItemIds.includes(child.itemId);
    const target =
      nextItem.slots.find((slot) => slot.nameId === nameId && accepts(slot)) ??
      nextItem.slots.find(accepts);
    if (!target) continue;
    used.add(target.id);
    slots[target.id] = child;
  }
  return { itemId: nextItem.id, slots };
}
