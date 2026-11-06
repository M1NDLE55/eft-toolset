import { readStore, writeStore, type StoreDefinition } from "./versioned-store";
import { GROUP_STORE } from "@/app/lib/item-groups/store";
import { COLLAPSED_STORE, SCOUTED_STORE } from "@/app/lib/scouted-items/store";
import { BUILD_STORE, PRICE_SOURCE_STORE, VIEW_STORE } from "@/app/lib/builds/store";
import { PLAN_STORE } from "@/app/lib/raid-planner/store";
import { LAYER_STORE } from "@/app/lib/raid-planner/layer-store";
import { TOOLBAR_STORE } from "@/app/lib/raid-planner/toolbar-store";
import { GAME_MODE_STORE } from "@/components/game-mode/mode";

export const BACKUP_FORMAT = "eft-toolset/backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

interface BackupEntry {
  label: string;
  definition: StoreDefinition<unknown>;
  identity?: (entry: unknown) => string;
}

function field(name: "name" | "id") {
  return (entry: unknown) => String((entry as Record<string, unknown>)[name]);
}

export const BACKUP_STORES: readonly BackupEntry[] = [
  { label: "Item groups", definition: GROUP_STORE as StoreDefinition<unknown>, identity: (entry) => field("name")(entry).toLocaleLowerCase() },
  { label: "Gun builds", definition: BUILD_STORE as StoreDefinition<unknown>, identity: field("id") },
  { label: "Raid plans", definition: PLAN_STORE as StoreDefinition<unknown>, identity: field("id") },
  { label: "Recently viewed items", definition: SCOUTED_STORE as StoreDefinition<unknown>, identity: field("name") },
  { label: "Game mode", definition: GAME_MODE_STORE as StoreDefinition<unknown> },
  { label: "Gun builder price sources", definition: PRICE_SOURCE_STORE as StoreDefinition<unknown> },
  { label: "Gun builder view", definition: VIEW_STORE as StoreDefinition<unknown> },
  { label: "Raid planner layers", definition: LAYER_STORE as StoreDefinition<unknown> },
  { label: "Raid planner toolbar", definition: TOOLBAR_STORE as StoreDefinition<unknown> },
  { label: "Sidebar", definition: COLLAPSED_STORE as StoreDefinition<unknown> },
];

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  stores: Record<string, unknown>;
}

export function countOf(value: unknown) {
  return Array.isArray(value) ? value.length : null;
}

export function createBackup(now = new Date()): BackupFile {
  const stores: Record<string, unknown> = {};
  for (const { definition } of BACKUP_STORES) stores[definition.key] = readStore(definition);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), stores };
}

export interface RestorePlanEntry {
  key: string;
  label: string;
  incoming: unknown;
  count: number | null;
  mergeable: boolean;
}

export interface RestorePlan {
  exportedAt: string | null;
  entries: RestorePlanEntry[];
  rejected: string[];
}

export function parseBackup(text: string): RestorePlan {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) {
    throw new Error("This backup is larger than 10 MB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("This is not an EFT Toolset backup.");
  const file = parsed as Partial<BackupFile>;
  if (file.format !== BACKUP_FORMAT) throw new Error("This is not an EFT Toolset backup.");
  if (typeof file.version !== "number" || !Number.isInteger(file.version)) throw new Error("This backup has no valid version.");
  if (file.version > BACKUP_VERSION) throw new Error("This backup was made by a newer version of EFT Toolset.");
  const stores = file.stores;
  if (!stores || typeof stores !== "object" || Array.isArray(stores)) throw new Error("This backup contains no data.");

  const entries: RestorePlanEntry[] = [];
  const rejected: string[] = [];
  for (const { label, definition, identity } of BACKUP_STORES) {
    if (!Object.hasOwn(stores, definition.key)) continue;
    const incoming = (stores as Record<string, unknown>)[definition.key];
    if (!definition.validate(incoming)) {
      rejected.push(label);
      continue;
    }
    entries.push({ key: definition.key, label, incoming, count: countOf(incoming), mergeable: Boolean(identity) });
  }
  if (entries.length === 0) throw new Error(rejected.length ? "None of the data in this backup is valid." : "This backup contains no data.");
  const exportedAt = typeof file.exportedAt === "string" && !Number.isNaN(Date.parse(file.exportedAt)) ? file.exportedAt : null;
  return { exportedAt, entries, rejected };
}

export function mergeValues(existing: unknown, incoming: unknown, identity: (entry: unknown) => string) {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return incoming;
  const seen = new Set(existing.map(identity));
  return [...existing, ...incoming.filter((entry) => !seen.has(identity(entry)))];
}

export function applyRestore(plan: RestorePlan, mode: "merge" | "replace") {
  const prepared = plan.entries.map((entry) => {
    const store = BACKUP_STORES.find((candidate) => candidate.definition.key === entry.key)!;
    const value =
      mode === "merge" && store.identity
        ? mergeValues(readStore(store.definition), entry.incoming, store.identity)
        : entry.incoming;
    if (!store.definition.validate(value)) {
      throw new Error(`${store.label} would exceed its limit after merging. Use Replace or remove some first.`);
    }
    return { store, value };
  });
  for (const { store, value } of prepared) writeStore(store.definition, value);
}
