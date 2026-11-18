import type { QuestGraph, TraderChain } from "./graph";
import type { RequirementStatus } from "./types";

export const CHAIN_NODE = { width: 188, height: 46, columnGap: 44, rowGap: 10 } as const;

/** How an edge is drawn: a quest to complete, one only to start, or a failure branch. */
export type ChainEdgeKind = "complete" | "active" | "failed";

export function chainEdgeKind(status: readonly RequirementStatus[]): ChainEdgeKind {
  if (status.includes("complete")) return "complete";
  if (status.includes("active")) return "active";
  return "failed";
}

export interface ChainNode {
  id: string;
  column: number;
  row: number;
  x: number;
  y: number;
}

export interface ChainPath {
  from: string;
  to: string;
  kind: ChainEdgeKind;
  /** An SVG path from the right edge of the prerequisite to the left edge of the quest. */
  d: string;
}

export interface ChainLayout {
  width: number;
  height: number;
  nodes: ChainNode[];
  /** Order of each column after laying out, top to bottom. */
  columns: string[][];
  paths: ChainPath[];
  /** For each of the trader's quests, other traders' quests it needs and leads to. */
  external: Map<string, { needs: string[]; unlocks: string[] }>;
}

/**
 * Places a trader's chain on a grid: one column per depth, each quest below the last. Columns
 * after the first are ordered by where their prerequisites sit (then by level and name), which
 * keeps most edges short and uncrossed.
 */
export function layoutChain(graph: QuestGraph, chain: TraderChain): ChainLayout {
  const own = (id: string) => chain.depth.has(id);
  const parents = new Map<string, string[]>();
  const external = new Map<string, { needs: string[]; unlocks: string[] }>();
  const entry = (id: string) => {
    let value = external.get(id);
    if (!value) external.set(id, (value = { needs: [], unlocks: [] }));
    return value;
  };
  for (const edge of chain.edges) {
    if (own(edge.from) && own(edge.to) && !edge.crossTrader) {
      parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
    } else if (own(edge.to)) {
      entry(edge.to).needs.push(edge.from);
    } else if (own(edge.from)) {
      entry(edge.from).unlocks.push(edge.to);
    }
  }

  const row = new Map<string, number>();
  const columns = chain.columns.map((column, index) => {
    const ordered =
      index === 0
        ? column
        : column
            .map((id, position) => {
              const rows = (parents.get(id) ?? []).map((parent) => row.get(parent)).filter((value) => value !== undefined);
              const centre = rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : Number.POSITIVE_INFINITY;
              return { id, centre, position };
            })
            .sort((a, b) => a.centre - b.centre || a.position - b.position)
            .map((entry) => entry.id);
    ordered.forEach((id, position) => row.set(id, position));
    return ordered;
  });

  const { width, height, columnGap, rowGap } = CHAIN_NODE;
  const nodes: ChainNode[] = columns.flatMap((column, columnIndex) =>
    column.map((id, rowIndex) => ({
      id,
      column: columnIndex,
      row: rowIndex,
      x: columnIndex * (width + columnGap),
      y: rowIndex * (height + rowGap),
    }))
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const paths: ChainPath[] = [];
  for (const edge of chain.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to || edge.crossTrader || !graph.byId.has(edge.from)) continue;
    const x1 = from.x + width;
    const y1 = from.y + height / 2;
    const x2 = to.x;
    const y2 = to.y + height / 2;
    const bend = Math.max(columnGap / 2, (x2 - x1) / 3);
    paths.push({ from: edge.from, to: edge.to, kind: chainEdgeKind(edge.status), d: `M${x1} ${y1}C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}` });
  }
  const tallest = Math.max(0, ...columns.map((column) => column.length));
  return {
    width: Math.max(0, columns.length * (width + columnGap) - columnGap),
    height: Math.max(0, tallest * (height + rowGap) - rowGap),
    nodes,
    columns,
    paths,
    external,
  };
}
