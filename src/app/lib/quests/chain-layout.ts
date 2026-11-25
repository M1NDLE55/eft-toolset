import type { QuestGraph, TraderChain } from "./graph";
import type { RequirementStatus } from "./types";

export const CHAIN_NODE = { width: 188, height: 46, columnGap: 44, rowGap: 10, chainGap: 28 } as const;

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
  /** The chained quests by depth, each column top to bottom as the tree stacks them. */
  columns: string[][];
  /** Where each chain sits, top to bottom: quests linked by the trader's own requirements. */
  chains: { top: number; height: number }[];
  /** The trader's quests with no requirement to or from another of theirs, by level then name. */
  standalone: string[];
  paths: ChainPath[];
  /** For each of the trader's quests, other traders' quests it needs and leads to. */
  external: Map<string, { needs: string[]; unlocks: string[] }>;
}

/**
 * Lays a trader's chain out as separate chains, stacked: quests linked by the trader's own
 * requirements form a chain, the biggest first, then the one starting at the lowest level.
 * Within a chain there is one column per depth, and columns after the first are ordered by
 * where their prerequisites sit (then by level and name), which keeps most edges short and
 * uncrossed. Quests with no link to the trader's other quests are listed apart.
 */
export function layoutChain(graph: QuestGraph, chain: TraderChain): ChainLayout {
  const own = (id: string) => chain.depth.has(id);
  const parents = new Map<string, string[]>();
  const linked = new Map<string, string[]>();
  const link = (a: string, b: string) => linked.set(a, [...(linked.get(a) ?? []), b]);
  const external = new Map<string, { needs: string[]; unlocks: string[] }>();
  const entry = (id: string) => {
    let value = external.get(id);
    if (!value) external.set(id, (value = { needs: [], unlocks: [] }));
    return value;
  };
  for (const edge of chain.edges) {
    if (own(edge.from) && own(edge.to) && !edge.crossTrader) {
      parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
      link(edge.from, edge.to);
      link(edge.to, edge.from);
    } else if (own(edge.to)) {
      entry(edge.to).needs.push(edge.from);
    } else if (own(edge.from)) {
      entry(edge.from).unlocks.push(edge.to);
    }
  }

  // Chains in the order the trader's columns list their quests, so each keeps level-then-name order.
  const order = chain.columns.flat();
  const position = new Map(order.map((id, index) => [id, index]));
  const standalone = order.filter((id) => !linked.has(id));
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const id of order) {
    if (seen.has(id) || !linked.has(id)) continue;
    const group = [id];
    seen.add(id);
    for (let index = 0; index < group.length; index += 1) {
      for (const next of linked.get(group[index]) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        group.push(next);
      }
    }
    groups.push(group.slice().sort((a, b) => position.get(a)! - position.get(b)!));
  }
  const firstLevel = (group: string[]) => Math.min(...group.map((id) => graph.byId.get(id)?.minPlayerLevel ?? 0));
  groups.sort((a, b) => b.length - a.length || firstLevel(a) - firstLevel(b) || position.get(a[0])! - position.get(b[0])!);

  const { width, height, columnGap, rowGap, chainGap } = CHAIN_NODE;
  const nodes: ChainNode[] = [];
  const columns: string[][] = [];
  const chains: ChainLayout["chains"] = [];
  let top = 0;
  for (const group of groups) {
    // A requirement cycle can leave a chain without a quest at depth 0: start it at its shallowest.
    const shift = Math.min(...group.map((id) => chain.depth.get(id)!));
    const byDepth: string[][] = [];
    for (const id of group) (byDepth[chain.depth.get(id)! - shift] ??= []).push(id);
    const row = new Map<string, number>();
    const ordered = Array.from(byDepth, (column, index) => {
      const ids = column ?? [];
      const result =
        index === 0
          ? ids
          : ids
              .map((id, place) => {
                const rows = (parents.get(id) ?? []).map((parent) => row.get(parent)).filter((value) => value !== undefined);
                const centre = rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : Number.POSITIVE_INFINITY;
                return { id, centre, place };
              })
              .sort((a, b) => a.centre - b.centre || a.place - b.place)
              .map((item) => item.id);
      result.forEach((id, place) => row.set(id, place));
      return result;
    });
    ordered.forEach((column, columnIndex) => {
      (columns[columnIndex] ??= []).push(...column);
      column.forEach((id, rowIndex) =>
        nodes.push({ id, column: columnIndex, row: rowIndex, x: columnIndex * (width + columnGap), y: top + rowIndex * (height + rowGap) })
      );
    });
    const tallest = Math.max(...ordered.map((column) => column.length));
    const blockHeight = tallest * (height + rowGap) - rowGap;
    chains.push({ top, height: blockHeight });
    top += blockHeight + chainGap;
  }

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
  return {
    width: Math.max(0, columns.length * (width + columnGap) - columnGap),
    height: Math.max(0, top - chainGap),
    nodes,
    columns,
    chains,
    standalone,
    paths,
    external,
  };
}
