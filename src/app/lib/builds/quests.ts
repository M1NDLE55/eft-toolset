import { normalizeText } from "@/app/lib/search/normalize-text";

// Tasks as a graph: which tasks a player has done, and what is left to do to unlock offers.

export interface TaskNode {
  id: string;
  name: string;
  normalizedName: string | null;
  /** The trader who gives the task. */
  trader: string | null;
  minPlayerLevel: number;
  /** USEC or BEAR when only that faction gets the task. */
  faction: string | null;
  /** Tasks this one needs, with the statuses that satisfy each (complete, active, failed). */
  requires: { id: string; status: string[] }[];
  /** Trader loyalty levels the task needs before it is given. */
  traderLevels: { trader: string; level: number }[];
}

export type TaskIndex = ReadonlyMap<string, TaskNode>;

const compact = (value: string) => normalizeText(value).replace(/[^\p{L}\p{N}]/gu, "");

const nameKeys = new WeakMap<TaskIndex, Map<string, string[]>>();

function keysFor(index: TaskIndex) {
  let keys = nameKeys.get(index);
  if (!keys) {
    keys = new Map();
    for (const task of index.values()) {
      for (const key of new Set([compact(task.name), task.normalizedName ? compact(task.normalizedName) : ""])) {
        if (key) keys.set(key, [...(keys.get(key) ?? []), task.id]);
      }
    }
    nameKeys.set(index, keys);
  }
  return keys;
}

/**
 * The tasks an input names: an id, or a name or slug ignoring case and punctuation. Faction
 * variants share a name, so one name can be several tasks. Empty when nothing matches; typos
 * are never guessed.
 */
export function matchTasks(index: TaskIndex, input: string): string[] {
  const trimmed = input.trim();
  if (index.has(trimmed)) return [trimmed];
  return keysFor(index).get(compact(trimmed)) ?? [];
}

/** Whether a requirement is met by finishing the task it names. */
const needsComplete = (status: string[]) => status.includes("complete");
/** Whether a requirement only needs the task it names to be started. */
const needsStart = (status: string[]) => !needsComplete(status) && status.includes("active");

/**
 * Every task the completed ones prove done: each task, and the tasks it had to complete
 * first, recursively.
 */
export function expandCompleted(index: TaskIndex, ids: Iterable<string>): Set<string> {
  const done = new Set<string>();
  const pending = [...ids];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (done.has(id)) continue;
    done.add(id);
    for (const requirement of index.get(id)?.requires ?? []) {
      if (needsComplete(requirement.status)) pending.push(requirement.id);
    }
  }
  return done;
}

export interface ChainStep {
  task: TaskNode;
  /** Only to be started: a later task needs it active, not complete. */
  startOnly: boolean;
  /** What completing this task unlocks, for the tasks that unlock offers. */
  unlocks: string[];
}

/**
 * The tasks still to do to unlock offers, with the tasks each one needs first, once each and
 * in an order they can be done: every task comes after the tasks it requires. Requirements a
 * task can meet by failing another (alternative branches) are not followed.
 *
 * @param unlocks what each task unlocks, keyed by task id, in the order to list them
 */
export function questChain(
  index: TaskIndex,
  unlocks: ReadonlyMap<string, readonly string[]>,
  completed: ReadonlySet<string>
): ChainStep[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const mustComplete = new Set<string>();
  const visit = (id: string, complete: boolean) => {
    if (completed.has(id) || !index.has(id)) return;
    if (complete) mustComplete.add(id);
    if (visited.has(id)) return;
    visited.add(id);
    for (const requirement of index.get(id)!.requires) {
      if (needsComplete(requirement.status)) visit(requirement.id, true);
      else if (needsStart(requirement.status)) visit(requirement.id, false);
    }
    order.push(id);
  };
  for (const id of unlocks.keys()) visit(id, true);
  return order.map((id) => ({
    task: index.get(id)!,
    startOnly: !mustComplete.has(id),
    unlocks: [...(unlocks.get(id) ?? [])],
  }));
}
