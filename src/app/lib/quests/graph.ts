import { needsComplete, needsStart } from "@/app/lib/builds/quests";
import type { QuestRequirement, QuestSummary, RequirementStatus } from "./types";

export interface QuestGraph {
  quests: readonly QuestSummary[];
  byId: ReadonlyMap<string, QuestSummary>;
  bySlug: ReadonlyMap<string, QuestSummary>;
  /** For each quest, the quests that require it and the status they need of it. */
  unlocks: ReadonlyMap<string, readonly QuestRequirement[]>;
}

const graphs = new WeakMap<readonly QuestSummary[], QuestGraph>();

/** Indexes a quest list; the same list gives the same graph. */
export function questGraph(quests: readonly QuestSummary[]): QuestGraph {
  let graph = graphs.get(quests);
  if (graph) return graph;
  const byId = new Map(quests.map((quest) => [quest.id, quest]));
  const bySlug = new Map(quests.flatMap((quest) => (quest.slug ? [[quest.slug, quest] as const] : [])));
  const unlocks = new Map<string, QuestRequirement[]>();
  for (const quest of quests) {
    for (const requirement of quest.requires) {
      if (!byId.has(requirement.id)) continue;
      const list = unlocks.get(requirement.id) ?? [];
      list.push({ id: quest.id, status: requirement.status });
      unlocks.set(requirement.id, list);
    }
  }
  graph = { quests, byId, bySlug, unlocks };
  graphs.set(quests, graph);
  return graph;
}

/** Chains follow requirements to complete or start a quest; a requirement only met by failing one is a branch. */
export const followsInChain = (status: readonly RequirementStatus[]) => needsComplete(status) || needsStart(status);

/** Every quest to complete or start before this one, prerequisites first, without the quest itself. */
export function chainBefore(graph: QuestGraph, id: string): string[] {
  const order: string[] = [];
  const visited = new Set<string>([id]);
  const visit = (current: string) => {
    for (const requirement of graph.byId.get(current)?.requires ?? []) {
      if (!followsInChain(requirement.status) || visited.has(requirement.id) || !graph.byId.has(requirement.id)) continue;
      visited.add(requirement.id);
      visit(requirement.id);
      order.push(requirement.id);
    }
  };
  visit(id);
  return order;
}

/** Every quest that follows from this one through requirements to complete or start it, nearest first. */
export function chainAfter(graph: QuestGraph, id: string): string[] {
  const order: string[] = [];
  const visited = new Set<string>([id]);
  const pending = [id];
  for (let index = 0; index < pending.length; index += 1) {
    for (const next of graph.unlocks.get(pending[index]) ?? []) {
      if (!followsInChain(next.status) || visited.has(next.id)) continue;
      visited.add(next.id);
      order.push(next.id);
      pending.push(next.id);
    }
  }
  return order;
}

export interface ChainEdge {
  /** The prerequisite. */
  from: string;
  to: string;
  status: RequirementStatus[];
  /** One end belongs to another trader. */
  crossTrader: boolean;
}

export interface TraderChain {
  trader: string;
  /**
   * The trader's quests by depth: a quest with no prerequisite from the same trader is in the
   * first column, and every other one column after its deepest same-trader prerequisite.
   * Each column is ordered by level, then name.
   */
  columns: string[][];
  /** Each quest's column. */
  depth: ReadonlyMap<string, number>;
  /** Requirements between the trader's quests, and to or from other traders' quests. */
  edges: ChainEdge[];
}

export function traderChain(graph: QuestGraph, trader: string): TraderChain {
  const own = graph.quests.filter((quest) => quest.trader === trader);
  const ownIds = new Set(own.map((quest) => quest.id));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    // A cycle in the data: break it here rather than recurse forever.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let value = 0;
    for (const requirement of graph.byId.get(id)!.requires) {
      if (ownIds.has(requirement.id)) value = Math.max(value, depthOf(requirement.id) + 1);
    }
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  const columns: QuestSummary[][] = [];
  for (const quest of own) (columns[depthOf(quest.id)] ??= []).push(quest);
  const edges: ChainEdge[] = [];
  for (const quest of graph.quests) {
    for (const requirement of quest.requires) {
      const from = graph.byId.get(requirement.id);
      if (!from || (!ownIds.has(quest.id) && !ownIds.has(from.id))) continue;
      edges.push({ from: from.id, to: quest.id, status: requirement.status, crossTrader: from.trader !== quest.trader });
    }
  }
  // Only a cycle leaves a column empty; drop it so columns and depths agree.
  const laidOut = Array.from(columns, (column) => (column ?? []).toSorted(byLevelThenName).map((quest) => quest.id)).filter(
    (column) => column.length > 0
  );
  return {
    trader,
    columns: laidOut,
    depth: new Map(laidOut.flatMap((column, index) => column.map((id) => [id, index] as const))),
    edges,
  };
}

export function byLevelThenName(a: QuestSummary, b: QuestSummary) {
  return a.minPlayerLevel - b.minPlayerLevel || a.name.localeCompare(b.name);
}
