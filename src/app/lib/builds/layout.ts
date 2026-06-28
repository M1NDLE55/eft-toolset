import type {
  BuildItemData,
  BuildNode,
  ModSlotDef,
} from "@/app/lib/types/gunBuilder";

export type FlowNodeKind = "weapon" | "filled" | "empty" | "missing";

export interface PositionedNode {
  id: string;
  kind: FlowNodeKind;
  itemId: string | null;
  slot: ModSlotDef | null;
  path: string[];
  parentPath: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FlowLayout {
  nodes: PositionedNode[];
  edges: FlowEdge[];
  width: number;
  height: number;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;
const ROOT_HEIGHT = 112;
const COLUMN_GAP = 92;
const ROW_GAP = 18;
const PAD = 24;

interface LayoutBranch {
  node: PositionedNode;
  children: LayoutBranch[];
  extent: number;
}

function nodeId(path: string[], slotId?: string) {
  if (path.length === 0 && !slotId) return "root";
  return [...path, slotId].filter(Boolean).join(":");
}

function buildBranch(
  node: BuildNode,
  data: Map<string, BuildItemData>,
  depth: number,
  path: string[],
  slot: ModSlotDef | null
): LayoutBranch {
  const item = data.get(node.itemId);
  const slots = item?.slots ?? [];
  const children = slots.map((childSlot) => {
    const child = node.slots[childSlot.id];
    if (child) {
      return buildBranch(child, data, depth + 1, [...path, childSlot.id], childSlot);
    }

    const emptyNode: PositionedNode = {
      id: nodeId(path, childSlot.id),
      kind: "empty",
      itemId: null,
      slot: childSlot,
      path: [...path, childSlot.id],
      parentPath: path,
      x: PAD + (depth + 1) * (NODE_WIDTH + COLUMN_GAP),
      y: 0,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
    return { node: emptyNode, children: [], extent: NODE_HEIGHT };
  });

  const extent =
    children.length === 0
      ? depth === 0
        ? ROOT_HEIGHT
        : NODE_HEIGHT
      : children.reduce((total, child) => total + child.extent, 0) +
        ROW_GAP * Math.max(0, children.length - 1);

  return {
    node: {
      id: nodeId(path),
      kind: depth === 0 ? "weapon" : item ? "filled" : "missing",
      itemId: node.itemId,
      slot,
      path,
      parentPath: path.slice(0, -1),
      x: PAD + depth * (NODE_WIDTH + COLUMN_GAP),
      y: 0,
      width: NODE_WIDTH,
      height: depth === 0 ? ROOT_HEIGHT : NODE_HEIGHT,
    },
    children,
    extent: Math.max(extent, depth === 0 ? ROOT_HEIGHT : NODE_HEIGHT),
  };
}

function placeBranch(
  branch: LayoutBranch,
  top: number,
  nodes: PositionedNode[],
  edges: FlowEdge[]
) {
  const centerY = top + branch.extent / 2;
  branch.node.y = centerY - branch.node.height / 2;
  nodes.push(branch.node);

  let childTop = top;
  for (const child of branch.children) {
    placeBranch(child, childTop, nodes, edges);
    edges.push({
      id: `${branch.node.id}->${child.node.id}`,
      from: branch.node.id,
      to: child.node.id,
      x1: branch.node.x + branch.node.width,
      y1: branch.node.y + branch.node.height / 2,
      x2: child.node.x,
      y2: child.node.y + child.node.height / 2,
    });
    childTop += child.extent + ROW_GAP;
  }
}

export function layoutBuild(
  root: BuildNode,
  data: Map<string, BuildItemData>
): FlowLayout {
  const branch = buildBranch(root, data, 0, [], null);
  const nodes: PositionedNode[] = [];
  const edges: FlowEdge[] = [];
  placeBranch(branch, PAD, nodes, edges);

  const width =
    nodes.reduce((max, node) => Math.max(max, node.x + node.width), 0) + PAD;
  const height =
    nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0) + PAD;

  return {
    nodes,
    edges,
    width,
    height: Math.max(height, ROOT_HEIGHT + PAD * 2),
  };
}
