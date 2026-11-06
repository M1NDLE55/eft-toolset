import type { BuildNode, ModSlotDef } from "@/app/lib/types/gunBuilder";
import { isDetailed, type ItemLookup } from "./stats";
import { childAt } from "./tree";

export type FlowNodeKind = "weapon" | "item" | "empty";

export interface PositionedNode {
  id: string;
  kind: FlowNodeKind;
  itemId: string | null;
  slot: ModSlotDef | null;
  slotId: string | null;
  path: string[];
  parentPath: string[];
  parentItemId: string | null;
  incompatible: boolean;
  isLastChild: boolean;
  ancestorGuides: boolean[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  empty: boolean;
}

export interface FlowLayout {
  nodes: PositionedNode[];
  edges: FlowEdge[];
  width: number;
  height: number;
}

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 72;
const COLUMN_GAP = 56;
const ROW_GAP = 12;
const PAD = 20;

interface Branch {
  node: PositionedNode;
  children: Branch[];
  extent: number;
}

interface ChildEntry {
  slotId: string;
  slot: ModSlotDef | null;
  child: BuildNode | undefined;
  incompatible: boolean;
}

function childEntries(node: BuildNode, lookup: ItemLookup): ChildEntry[] {
  const item = lookup.get(node.itemId);
  if (!isDetailed(item)) {
    return Object.entries(node.slots).map(([slotId, child]) => ({
      slotId,
      slot: null,
      child,
      incompatible: false,
    }));
  }
  const defined = new Set(item.slots.map((slot) => slot.id));
  return [
    ...item.slots.map((slot) => {
      const child = childAt(node, slot.id);
      return {
        slotId: slot.id,
        slot,
        child,
        incompatible: Boolean(child && !slot.allowedItemIds.includes(child.itemId)),
      };
    }),
    ...Object.entries(node.slots)
      .filter(([slotId]) => !defined.has(slotId))
      .map(([slotId, child]) => ({ slotId, slot: null, child, incompatible: true })),
  ];
}

function buildBranch(
  node: BuildNode | undefined,
  itemId: string | null,
  lookup: ItemLookup,
  hideEmpty: boolean,
  depth: number,
  path: string[],
  entry: ChildEntry | null,
  parentItemId: string | null,
  isLastChild: boolean,
  ancestorGuides: boolean[]
): Branch {
  const positioned: PositionedNode = {
    id: path.length === 0 ? "root" : path.join("/"),
    kind: depth === 0 ? "weapon" : node ? "item" : "empty",
    itemId,
    slot: entry?.slot ?? null,
    slotId: entry?.slotId ?? null,
    path,
    parentPath: path.slice(0, -1),
    parentItemId,
    incompatible: entry?.incompatible ?? false,
    isLastChild,
    ancestorGuides,
    x: PAD + depth * (NODE_WIDTH + COLUMN_GAP),
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  };
  if (!node) return { node: positioned, children: [], extent: NODE_HEIGHT };

  const entries = childEntries(node, lookup).filter(
    (entry) => !hideEmpty || entry.child || entry.slot?.required
  );
  const childGuides = depth === 0 ? [] : [...ancestorGuides, !isLastChild];
  const children = entries.map((child, index) =>
    buildBranch(
      child.child,
      child.child?.itemId ?? null,
      lookup,
      hideEmpty,
      depth + 1,
      [...path, child.slotId],
      child,
      node.itemId,
      index === entries.length - 1,
      childGuides
    )
  );
  const stacked =
    children.reduce((total, child) => total + child.extent, 0) +
    ROW_GAP * Math.max(0, children.length - 1);
  return { node: positioned, children, extent: Math.max(NODE_HEIGHT, stacked) };
}

function place(branch: Branch, top: number, nodes: PositionedNode[], edges: FlowEdge[]) {
  branch.node.y = top;
  nodes.push(branch.node);
  let childTop = top;
  for (const child of branch.children) {
    place(child, childTop, nodes, edges);
    edges.push({
      id: child.node.id,
      x1: branch.node.x + branch.node.width,
      y1: branch.node.y + branch.node.height / 2,
      x2: child.node.x,
      y2: child.node.y + child.node.height / 2,
      empty: child.node.kind === "empty",
    });
    childTop += child.extent + ROW_GAP;
  }
}

export function layoutBuild(root: BuildNode, lookup: ItemLookup, hideEmpty = false): FlowLayout {
  const branch = buildBranch(root, root.itemId, lookup, hideEmpty, 0, [], null, null, true, []);
  const nodes: PositionedNode[] = [];
  const edges: FlowEdge[] = [];
  place(branch, PAD, nodes, edges);
  return {
    nodes,
    edges,
    width: nodes.reduce((max, node) => Math.max(max, node.x + node.width), 0) + PAD,
    height: nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0) + PAD,
  };
}
