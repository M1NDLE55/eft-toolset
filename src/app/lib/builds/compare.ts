import type { BuildNode } from "@/app/lib/types/gunBuilder";
import { isDetailed, type BuildStats, type ItemLookup } from "./stats";

export type DiffStatus = "same" | "changed" | "added" | "removed";

export interface SlotDiffRow {
  key: string;
  label: string;
  context: string[];
  depth: number;
  left: string | null;
  right: string | null;
  status: DiffStatus;
}

interface DiffTrieNode {
  label: string;
  left: string | null;
  right: string | null;
  children: Map<string, DiffTrieNode>;
}

export function slotKey(nameId: string) {
  return nameId.toLowerCase().replace(/_\d+$/, "");
}

function orderedSlots(node: BuildNode, lookup: ItemLookup) {
  const item = lookup.get(node.itemId);
  const defs = isDetailed(item) ? item.slots : [];
  const entries: { slotId: string; nameId: string; label: string; child: BuildNode }[] = [];
  const listed = new Set<string>();
  for (const def of defs) {
    if (!Object.hasOwn(node.slots, def.id)) continue;
    listed.add(def.id);
    entries.push({ slotId: def.id, nameId: def.nameId, label: def.name, child: node.slots[def.id] });
  }
  for (const slotId of Object.keys(node.slots).sort()) {
    if (listed.has(slotId)) continue;
    entries.push({ slotId, nameId: slotId, label: slotId, child: node.slots[slotId] });
  }
  return entries;
}

function insert(trie: DiffTrieNode, node: BuildNode, side: "left" | "right", lookup: ItemLookup, depth: number) {
  if (depth > 64) return;
  const counts = new Map<string, number>();
  for (const entry of orderedSlots(node, lookup)) {
    const base = slotKey(entry.nameId);
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    const key = count > 1 ? `${base}#${count}` : base;
    let branch = trie.children.get(key);
    if (!branch) {
      branch = { label: entry.label, left: null, right: null, children: new Map() };
      trie.children.set(key, branch);
    }
    branch[side] = entry.child.itemId;
    insert(branch, entry.child, side, lookup, depth + 1);
  }
}

export function diffBuildTrees(left: BuildNode, right: BuildNode, lookup: ItemLookup): SlotDiffRow[] {
  const trie: DiffTrieNode = { label: "", left: left.itemId, right: right.itemId, children: new Map() };
  insert(trie, left, "left", lookup, 0);
  insert(trie, right, "right", lookup, 0);
  const rows: SlotDiffRow[] = [];
  const walk = (branch: DiffTrieNode, prefix: string, context: string[], depth: number) => {
    for (const [key, child] of branch.children) {
      const path = prefix ? `${prefix}/${key}` : key;
      rows.push({
        key: path,
        label: child.label,
        context,
        depth,
        left: child.left,
        right: child.right,
        status:
          child.left && child.right
            ? child.left === child.right
              ? "same"
              : "changed"
            : child.left
              ? "removed"
              : "added",
      });
      walk(child, path, [...context, child.label], depth + 1);
    }
  };
  walk(trie, "", [], 0);
  return rows;
}

export type StatKey = "ergonomics" | "recoilVertical" | "recoilHorizontal" | "weight" | "costRUB" | "partCount";

export interface StatDelta {
  key: StatKey;
  label: string;
  left: number | null;
  right: number | null;
  delta: number | null;
  better: "higher" | "lower";
  verdict: "better" | "worse" | "even" | null;
}

const STAT_ROWS: { key: StatKey; label: string; better: "higher" | "lower"; digits: number }[] = [
  { key: "ergonomics", label: "Ergonomics", better: "higher", digits: 0 },
  { key: "recoilVertical", label: "Vertical recoil", better: "lower", digits: 0 },
  { key: "recoilHorizontal", label: "Horizontal recoil", better: "lower", digits: 0 },
  { key: "weight", label: "Weight", better: "lower", digits: 2 },
  { key: "costRUB", label: "Cost", better: "lower", digits: 0 },
  { key: "partCount", label: "Parts", better: "lower", digits: 0 },
];

export function statDeltas(left: BuildStats, right: BuildStats): StatDelta[] {
  return STAT_ROWS.map(({ key, label, better, digits }) => {
    const a = left[key];
    const b = right[key];
    if (a === null || b === null) return { key, label, left: a, right: b, delta: null, better, verdict: null };
    const factor = 10 ** digits;
    const delta = Math.round((b - a) * factor) / factor;
    const verdict =
      key === "partCount" || delta === 0
        ? "even"
        : (better === "higher" ? delta > 0 : delta < 0)
          ? "better"
          : "worse";
    return { key, label, left: a, right: b, delta, better, verdict };
  });
}

export function treesEqual(a: BuildNode, b: BuildNode): boolean {
  if (a.itemId !== b.itemId) return false;
  const left = Object.keys(a.slots);
  const right = Object.keys(b.slots);
  if (left.length !== right.length) return false;
  return left.every((slotId) => Object.hasOwn(b.slots, slotId) && treesEqual(a.slots[slotId], b.slots[slotId]));
}
