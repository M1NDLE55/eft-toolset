import {
  applyBuildPatch,
  buildPatchFields,
  clashingBuildFields,
  diffBuild,
  foldBuildPatches,
  omitBuildFields,
  pickBuildFields,
  type BuildPatch,
} from "@/app/lib/sharing/build-patch";
import { applyGroupPatch, diffGroup, foldGroupPatches, omitGroupFields, type GroupPatch } from "@/app/lib/sharing/group-patch";
import type {
  BuildRecord,
  BuildValue,
  GroupValue,
  LibraryRecord,
  Mutation,
  MutationResult,
  Patch,
  RecordKind,
  SettingPatch,
  SettingRecord,
} from "@/app/lib/sharing/types";

/**
 * The browser's model of the account library (§12.5), independent of IndexedDB so it can be tested:
 * each record's confirmed server copy, the optimistic local value the UI shows (the server copy with
 * this device's queued mutations applied), and any conflict or sync problem waiting for the person.
 */
export interface CachedRecord {
  key: string;
  kind: RecordKind;
  id: string;
  /** As the server last confirmed it; null for a record created on this device and not yet acknowledged. */
  server: LibraryRecord | null;
  /** What the UI shows; null when deleted on this device. */
  local: LibraryRecord | null;
  conflict?: Conflict;
  problem?: SyncProblem;
}

export type Conflict =
  /** The same field changed on another device: Keep mine, Keep theirs or Keep both (§12.4 rule 2). */
  | { type: "fields"; fields: string[]; mine: Patch; theirs: { version: number; record: LibraryRecord }; mineValue: LibraryRecord | null }
  /** A delete against edits this device hadn't seen: "Delete anyway?" */
  | { type: "delete"; theirs: { version: number; record: LibraryRecord } };

/** A change the server refused (limit, invalid), listed under "Couldn't sync". */
export interface SyncProblem {
  code: string;
  message: string;
  value: LibraryRecord | null;
}

export interface QueueEntry {
  seq?: number;
  key: string;
  mutation: Mutation;
}

export function recordKey(kind: RecordKind, id: string) {
  return `${kind}:${id}`;
}

/** A record made on this device, before the server numbers it. */
export function provisionalRecord(kind: "build" | "item_group", id: string, value: BuildValue | GroupValue, now: number): LibraryRecord {
  const base = { id, version: 0, allowCopy: true, origin: "created" as const, copiedFrom: null, contentHash: "", createdAt: now, updatedAt: now };
  return kind === "build" ? { kind: "build", ...base, ...(value as BuildValue) } : { kind: "item_group", ...base, ...(value as GroupValue) };
}

/** Applies one mutation to the local value, as the server will. */
export function applyMutationLocally(local: LibraryRecord | null, mutation: Mutation, now: number): LibraryRecord | null {
  if (mutation.op === "delete") return null;
  if (mutation.op === "create") return provisionalRecord(mutation.kind, mutation.id, mutation.value, now);
  if (mutation.kind === "setting") {
    const patch = mutation.patch as SettingPatch;
    const previous = local as SettingRecord | null;
    return { kind: "setting", id: mutation.id, version: previous?.version ?? 0, value: patch.value, changedAt: patch.changedAt, updatedAt: now };
  }
  if (!local) return null;
  if (mutation.kind === "build" && local.kind === "build") {
    try {
      return { ...applyBuildPatch(local, mutation.patch as BuildPatch), updatedAt: now };
    } catch {
      return local;
    }
  }
  if (mutation.kind === "item_group" && local.kind === "item_group") return { ...applyGroupPatch(local, mutation.patch as GroupPatch), updatedAt: now };
  return local;
}

/** The local value: the server copy with the queued mutations for this record applied in order. */
export function rebase(server: LibraryRecord | null, queued: readonly Mutation[], now: number): LibraryRecord | null {
  let local = server && !server.deleted ? server : null;
  for (const mutation of queued) local = applyMutationLocally(local, mutation, now);
  return local;
}

function foldPatches(kind: RecordKind, first: Patch, second: Patch): Patch {
  if (kind === "build") return foldBuildPatches(first as BuildPatch, second as BuildPatch);
  if (kind === "item_group") return foldGroupPatches(first as GroupPatch, second as GroupPatch);
  return second;
}

/**
 * Folds queued mutations before replay (§12.5): consecutive changes to one record become one write,
 * keeping the earliest base version and the latest value of each field. A create followed by edits
 * becomes one create; a create followed by a delete disappears (mutation null: drop the entries).
 */
export function foldQueue(entries: readonly QueueEntry[], now: number): { mutation: Mutation | null; seqs: number[] }[] {
  const byKey = new Map<string, { mutation: Mutation | null; seqs: number[] }>();
  const order: string[] = [];
  for (const entry of entries) {
    const seq = entry.seq ?? -1;
    const current = byKey.get(entry.key);
    if (!current) {
      byKey.set(entry.key, { mutation: entry.mutation, seqs: [seq] });
      order.push(entry.key);
      continue;
    }
    current.seqs.push(seq);
    const previous = current.mutation;
    const next = entry.mutation;
    if (!previous) {
      current.mutation = next;
    } else if (previous.op === "create") {
      if (next.op === "delete") current.mutation = null;
      else if (next.op === "patch") {
        const value = applyMutationLocally(provisionalRecord(previous.kind, previous.id, previous.value, now), next, now);
        current.mutation = { ...previous, mutationId: next.mutationId, value: stripRecord(value) as never };
      } else current.mutation = next;
    } else if (previous.op === "patch" && next.op === "patch") {
      current.mutation = { ...previous, mutationId: next.mutationId, patch: foldPatches(previous.kind, previous.patch, next.patch) } as Mutation;
    } else if (previous.op === "patch" && next.op === "delete") {
      current.mutation = { ...next, baseVersion: previous.baseVersion };
    } else {
      current.mutation = next;
    }
  }
  return order.map((key) => byKey.get(key)!);
}

/** A record's content as a create mutation carries it. */
export function stripRecord(record: LibraryRecord | null): BuildValue | GroupValue | null {
  if (!record) return null;
  if (record.kind === "build") return { name: record.name, weaponId: record.weaponId, root: record.root, ...(record.ammoId ? { ammoId: record.ammoId } : {}) };
  if (record.kind === "item_group") return { name: record.name, items: record.items };
  return null;
}

/** The patch that turns one record into another, for "Keep mine" and for re-basing. */
export function diffRecords(before: LibraryRecord, after: LibraryRecord): Patch | null {
  if (before.kind === "build" && after.kind === "build") return diffBuild(before, after);
  if (before.kind === "item_group" && after.kind === "item_group") return diffGroup(before, after);
  return null;
}

/**
 * Fields another device changed, seen when this device's write came back merged: what the server
 * holds now, compared with what this device expected (its old copy with its own patch applied).
 */
export function remoteChangedFields(expected: LibraryRecord | null, actual: LibraryRecord): string[] {
  if (!expected) return [];
  if (expected.kind === "build" && actual.kind === "build") {
    const patch = diffBuild(expected as BuildRecord, actual);
    return patch ? buildPatchFields(patch) : [];
  }
  if (expected.kind === "item_group" && actual.kind === "item_group") return expected.name !== actual.name ? ["name"] : [];
  return [];
}

/** The fields of a queued patch that clash with fields another device changed (same rules as the server). */
export function clashesWith(kind: RecordKind, patch: Patch, changedFields: readonly string[]): string[] {
  if (changedFields.length === 0) return [];
  if (kind === "build") {
    const versions = Object.fromEntries(changedFields.map((field) => [field, 2]));
    return clashingBuildFields(patch as BuildPatch, versions, 1);
  }
  if (kind === "item_group") return (patch as GroupPatch).name !== undefined && changedFields.includes("name") ? ["name"] : [];
  return [];
}

/** Splits a conflicting patch: the fields that clashed wait for a choice, the rest go ahead. */
export function splitPatch(kind: RecordKind, patch: Patch, fields: readonly string[]): { clashing: Patch | null; rest: Patch | null } {
  if (kind === "build") return { clashing: pickBuildFields(patch as BuildPatch, fields), rest: omitBuildFields(patch as BuildPatch, fields) };
  if (kind === "item_group") {
    const group = patch as GroupPatch;
    return { clashing: fields.includes("name") && group.name !== undefined ? { name: group.name } : null, rest: omitGroupFields(group, fields) };
  }
  return { clashing: patch, rest: null };
}

/** How the device handles each result of a replayed batch. */
export type ResultAction =
  | { type: "confirm"; record: LibraryRecord; restored: boolean }
  | { type: "conflict"; conflict: Conflict; rest: Patch | null }
  | { type: "recreate" }
  | { type: "problem"; problem: SyncProblem }
  | { type: "retry"; afterSeconds: number }
  /** A delete of something already gone from the server: nothing left to do. */
  | { type: "drop" };

export function actionFor(result: MutationResult, mutation: Mutation, local: LibraryRecord | null): ResultAction {
  if (result.status === "applied") return { type: "confirm", record: result.record, restored: result.restored === true };
  if (result.status === "conflict") {
    if (mutation.op === "delete") return { type: "conflict", conflict: { type: "delete", theirs: result.theirs }, rest: null };
    const patch = (mutation as { patch: Patch }).patch;
    const { clashing, rest } = splitPatch(mutation.kind, patch, result.fields);
    return { type: "conflict", conflict: { type: "fields", fields: result.fields, mine: clashing ?? patch, theirs: result.theirs, mineValue: local }, rest };
  }
  if (result.code === "rate_limited") return { type: "retry", afterSeconds: result.details?.retryAfterSeconds ?? 5 };
  if (result.code === "gone") return mutation.op === "delete" ? { type: "drop" } : { type: "recreate" };
  return { type: "problem", problem: { code: result.code, message: result.message, value: local } };
}
