import { readStore, writeStores, type StoreDefinition } from "./versioned-store";
import { GROUP_STORE } from "@/app/lib/item-groups/store";
import { COLLAPSED_STORE, SCOUTED_STORE } from "@/app/lib/scouted-items/store";
import { BUILD_STORE, PRICE_SOURCE_STORE, VIEW_STORE } from "@/app/lib/builds/store";
import { PLAN_STORE } from "@/app/lib/raid-planner/store";
import { LAYER_STORE } from "@/app/lib/raid-planner/layer-store";
import { TOOLBAR_STORE } from "@/app/lib/raid-planner/toolbar-store";
import { GAME_MODE_STORE } from "@/components/game-mode/mode";
import { HOME_LAYOUT_STORE } from "@/app/lib/settings/store";
import { CONTENT_SCALE_STORE } from "@/app/lib/settings/content-scale";
import { ITEM_VIEWS_STORE } from "@/app/lib/item-views/store";
import { QUEST_PROGRESS_STORE } from "@/app/lib/quests/progress-store";
import { BACKUP_FORMAT, BACKUP_VERSION, STORE_KEYS } from "./store-keys";
import type { AccountLibrary } from "@/app/lib/account-sync/account-library";
import { readAllPlans } from "@/app/lib/account-sync/plan-cache";
import { contentOf } from "@/app/lib/sharing/plan-doc";
import { chunkForImport, jsonBytes } from "@/app/lib/account-sync/migration";

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
  { label: "Quest progress", definition: QUEST_PROGRESS_STORE as StoreDefinition<unknown> },
  { label: "Recently viewed items", definition: SCOUTED_STORE as StoreDefinition<unknown>, identity: field("name") },
  { label: "Game mode", definition: GAME_MODE_STORE as StoreDefinition<unknown> },
  { label: "Home screen", definition: HOME_LAYOUT_STORE as StoreDefinition<unknown> },
  { label: "Content size", definition: CONTENT_SCALE_STORE as StoreDefinition<unknown> },
  { label: "Item page views", definition: ITEM_VIEWS_STORE as StoreDefinition<unknown> },
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
  const prepared = plan.entries.flatMap((entry) => {
    const store = BACKUP_STORES.find((candidate) => candidate.definition.key === entry.key)!;
    if (mode === "merge" && !store.identity) return [];
    const value = store.identity && mode === "merge"
      ? mergeValues(readStore(store.definition), entry.incoming, store.identity)
      : entry.incoming;
    if (!store.definition.validate(value)) {
      throw new Error(`${store.label} would exceed its limit after merging. Use Replace or remove some first.`);
    }
    return [{ definition: store.definition, value }];
  });
  writeStores(prepared);
}

/** The builds, item groups and raid plans: kept in the account when signed in, not in this browser. */
export const LIBRARY_STORE_KEYS: readonly string[] = [STORE_KEYS.itemGroups, STORE_KEYS.gunBuilds, STORE_KEYS.raidPlans];

/**
 * A backup while signed in: the account's builds, item groups, and the plans cached here that the
 * user may export (owned, or copies allowed), with this browser's settings.
 */
export async function createAccountBackup(library: AccountLibrary, now = new Date()): Promise<BackupFile & { skippedPlans: number }> {
  const backup = createBackup(now);
  const view = library.view();
  const timestamps = (record: { createdAt: number; updatedAt: number }) => ({ createdAt: record.createdAt, updatedAt: record.updatedAt });
  backup.stores[STORE_KEYS.gunBuilds] = view.builds.map((build) => ({ id: build.id, name: build.name, weaponId: build.weaponId, root: build.root, ...(build.ammoId ? { ammoId: build.ammoId } : {}), ...timestamps(build) }));
  backup.stores[STORE_KEYS.itemGroups] = view.itemGroups.map((group) => ({ name: group.name, items: group.items }));
  const plans = await readAllPlans(library.database);
  const exportable = plans.filter((plan) => plan.state && (plan.state.role === "owner" || plan.state.allowCopy));
  backup.stores[STORE_KEYS.raidPlans] = exportable.map((plan) => ({ id: plan.planId, createdAt: plan.state!.createdAt, updatedAt: plan.state!.updatedAt, ...contentOf(plan.state!.doc) }));
  return { ...backup, skippedPlans: view.plans.length - exportable.length };
}

export interface AccountRestoreReport {
  created: number;
  duplicates: number;
  failed: string[];
}

/**
 * Restoring while signed in (§7.6): builds, item groups and plans go to the account, subject to its
 * limits (exact duplicates are skipped); settings restore into this browser as before.
 */
export async function restoreToAccount(plan: RestorePlan, library: AccountLibrary, mode: "merge" | "replace"): Promise<AccountRestoreReport> {
  const items: { type: "build" | "item_group" | "plan"; value: unknown; label: string }[] = [];
  for (const entry of plan.entries) {
    if (!LIBRARY_STORE_KEYS.includes(entry.key) || !Array.isArray(entry.incoming)) continue;
    const type = entry.key === STORE_KEYS.gunBuilds ? "build" : entry.key === STORE_KEYS.itemGroups ? "item_group" : "plan";
    for (const value of entry.incoming as Record<string, unknown>[]) {
      const content =
        type === "build"
          ? { name: value.name, weaponId: value.weaponId, root: value.root, ...(value.ammoId ? { ammoId: value.ammoId } : {}) }
          : type === "item_group"
            ? { name: value.name, items: value.items }
            : { name: value.name, mapKey: value.mapKey, enabledLayers: value.enabledLayers, route: value.route, drawings: value.drawings, notes: value.notes };
      items.push({ type, value: content, label: String(value.name ?? "") });
    }
  }
  const report: AccountRestoreReport = { created: 0, duplicates: 0, failed: [] };
  for (const batch of chunkForImport(items, (item) => jsonBytes(item.value))) {
    const response = await library.request("/api/library/import", { method: "POST", body: JSON.stringify({ origin: "restore", items: batch.map(({ type, value }) => ({ type, value })) }) });
    const body = (await response.json()) as { results?: { index: number; status: string; message?: string }[]; error?: { message: string } };
    if (!response.ok || !body.results) throw new Error(body.error?.message ?? "Restoring stopped partway. Try again: nothing is added twice.");
    for (const result of body.results) {
      if (result.status === "created") report.created += 1;
      else if (result.status === "duplicate") report.duplicates += 1;
      else report.failed.push(`${batch[result.index]?.label || "An item"}: ${result.message ?? result.status}`);
    }
  }
  const settings = { ...plan, entries: plan.entries.filter((entry) => !LIBRARY_STORE_KEYS.includes(entry.key)) };
  if (settings.entries.length > 0) applyRestore(settings, mode);
  await library.catchUp();
  return report;
}
