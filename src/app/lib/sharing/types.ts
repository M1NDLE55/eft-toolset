import type { BuildNode } from "@/app/lib/types/gunBuilder";
import type { BuildPatch } from "./build-patch";
import type { GroupPatch } from "./group-patch";

/** What the server, the browser and MCP tools exchange about a user's library (§12). */

export type LibraryKind = "build" | "item_group" | "setting" | "plan";
export type RecordKind = "build" | "item_group" | "setting";
export type Role = "owner" | "editor" | "viewer";
export type Origin = "created" | "copy" | "migration" | "restore" | "mcp";

export interface BuildValue {
  name: string;
  weaponId: string;
  root: BuildNode;
  ammoId?: string;
}

export interface GroupValue {
  name: string;
  items: string[];
}

interface RecordBase {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Set on tombstones in the change feed. */
  deleted?: boolean;
}

export interface BuildRecord extends RecordBase, BuildValue {
  kind: "build";
  allowCopy: boolean;
  origin: Origin;
  copiedFrom: string | null;
  contentHash: string;
}

export interface GroupRecord extends RecordBase, GroupValue {
  kind: "item_group";
  allowCopy: boolean;
  origin: Origin;
  copiedFrom: string | null;
  contentHash: string;
}

export interface SettingRecord {
  kind: "setting";
  id: string;
  version: number;
  value: unknown;
  changedAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/** An entry in the user's plan index. PlanDO is the authority; this is a cache for listing. */
export interface PlanIndexRecord {
  kind: "plan";
  id: string;
  version: number;
  relation: "owned" | "shared";
  role: Role;
  status: "pending" | "active";
  name: string | null;
  mapKey: string | null;
  updatedAt: number | null;
  rev: number | null;
  since: number;
  deleted?: boolean;
}

export type LibraryRecord = BuildRecord | GroupRecord | SettingRecord | PlanIndexRecord;

export interface SettingPatch {
  value: unknown;
  /** The device clock when the change was made: the newest change wins for preferences. */
  changedAt: number;
}

export type Patch = BuildPatch | GroupPatch | SettingPatch;

export type Mutation =
  | { mutationId: string; kind: "build"; op: "create"; id: string; value: BuildValue }
  | { mutationId: string; kind: "item_group"; op: "create"; id: string; value: GroupValue }
  | { mutationId: string; kind: "build"; op: "patch"; id: string; baseVersion: number; patch: BuildPatch }
  | { mutationId: string; kind: "item_group"; op: "patch"; id: string; baseVersion: number; patch: GroupPatch }
  | { mutationId: string; kind: "setting"; op: "patch"; id: string; baseVersion: number; patch: SettingPatch }
  | { mutationId: string; kind: RecordKind; op: "delete"; id: string; baseVersion: number };

export type RejectCode = "limit" | "invalid" | "forbidden" | "rate_limited" | "gone";

export type MutationResult =
  | { mutationId: string; status: "applied"; version: number; record: LibraryRecord; merged: boolean; restored?: boolean }
  | { mutationId: string; status: "conflict"; fields: string[]; mine: Patch | null; theirs: { version: number; record: LibraryRecord } }
  | { mutationId: string; status: "rejected"; code: RejectCode; message: string; details?: { limit?: number; used?: number; retryAfterSeconds?: number } };

export interface Usage {
  ownedPlans: number;
  sharedPlans: number;
  builds: number;
  itemGroups: number;
}

export interface Notice {
  id: number;
  kind: string;
  body: string;
  createdAt: number;
}

export interface LibrarySnapshot {
  seq: number;
  records: LibraryRecord[];
  usage: Usage;
  limits: Usage;
  notices: Notice[];
  hashes: { builds: string[]; itemGroups: string[]; plans: string[] };
  displayName: string;
}

export type ChangesResult =
  | { resync: true }
  | { resync?: false; seq: number; records: LibraryRecord[]; tombstones: { kind: LibraryKind; id: string; version: number }[] };

/** Messages on the library change feed (§12.6), server to client only. */
export type FeedMessage =
  | { type: "changes"; seq: number; records: LibraryRecord[]; tombstones: { kind: LibraryKind; id: string; version: number }[]; originMutationIds: string[] }
  | { type: "resync" }
  | { type: "notice"; notice: Notice };

/** Errors from every sharing route: `{ error: { code, message, details? } }`. */
export type ErrorCode = "unauthenticated" | "forbidden" | "not_found" | "gone" | "conflict" | "limit" | "rate_limited" | "invalid";

export interface ApiError {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}
