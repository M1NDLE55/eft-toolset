import { consumeTokens, type BucketLimit, type RequestBudget } from "@/app/lib/api/rate-limit-store";
import { isGunBuild } from "@/app/lib/builds/validation";
import { isGroup } from "@/app/lib/item-groups/validation";
import { MAX_GROUP_NAME_LENGTH } from "@/app/lib/item-groups/limits";
import {
  applyBuildPatch,
  clashingBuildFields,
  initialBuildFieldVersions,
  nextBuildFieldVersions,
  PatchError,
  type BuildPatch,
} from "@/app/lib/sharing/build-patch";
import {
  applyGroupPatch,
  clashingGroupFields,
  initialGroupFieldVersions,
  nextGroupFieldVersions,
  uniqueGroupName,
  type GroupPatch,
} from "@/app/lib/sharing/group-patch";
import { buildHash, groupHash } from "@/app/lib/sharing/content-hash";
import { isRecordId } from "@/app/lib/sharing/ids";
import { isSettingKey, isConflictingSettingKey } from "@/app/lib/sharing/settings-keys";
import type {
  BuildRecord,
  BuildValue,
  ChangesResult,
  GroupRecord,
  GroupValue,
  LibraryKind,
  LibraryRecord,
  LibrarySnapshot,
  Mutation,
  MutationResult,
  Notice,
  Origin,
  PlanIndexRecord,
  RecordKind,
  Role,
  SettingPatch,
  SettingRecord,
  Usage,
} from "@/app/lib/sharing/types";
import {
  LIMIT_MESSAGES,
  overLimitMessage,
  PENDING_RESERVATION_MS,
  RETENTION_MS,
  USER_LIMITS,
  USER_RATES,
  type UserRate,
} from "./limits";
import { DomainError, forbidden, invalid, limitError, migrate, notFound, type Migration, type Sql } from "./sql";

/**
 * One user's account data, keyed by their WorkOS user id. It runs inside the user's Durable Object
 * (UserDO), which serves one request at a time, so every count limit here is exact.
 *
 * - Builds and item groups, each with a version and per-field versions, changed through mutations
 *   that merge when they touch different fields and report a conflict when the same field clashed
 *   (§12.2, §12.4). Deletes leave a tombstone for 30 days, so an offline edit can still restore it.
 * - Synced settings: the newest change wins, except quest progress, which reports clashes.
 * - The change log: one row per record with the seq of its last change, so "changes since N" is a
 *   range query and the log never grows past the library itself.
 * - The index of plans the user owns or belongs to (PlanDO is the authority) and the plan limits.
 * - Links to builds and item groups, token buckets for the per-user rates, notices and an outbox.
 */
export const USER_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        user_id TEXT NOT NULL,
        email TEXT,
        name TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE builds (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE item_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE plans (
        plan_id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
        title TEXT NOT NULL,
        map TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        added_at INTEGER NOT NULL
      )`,
      "CREATE INDEX plans_by_role ON plans (role, updated_at)",
      "CREATE TABLE plan_creations (created_at INTEGER NOT NULL)",
      "CREATE INDEX plan_creations_by_time ON plan_creations (created_at)",
      `CREATE TABLE budgets (key TEXT PRIMARY KEY, tokens REAL NOT NULL, updated_at INTEGER NOT NULL)`,
    ],
  },
  {
    // Version 1's builds, item groups and plan index were never written by any feature (only the
    // MCP budget was), so they are replaced rather than migrated. The budgets keep their rows.
    version: 2,
    statements: [
      "DROP TABLE profile",
      "DROP TABLE builds",
      "DROP TABLE item_groups",
      "DROP INDEX plans_by_role",
      "DROP TABLE plans",
      "DROP INDEX plan_creations_by_time",
      "DROP TABLE plan_creations",
      `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE TABLE profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE builds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        weapon_id TEXT NOT NULL,
        data TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        allow_copy INTEGER NOT NULL DEFAULT 1,
        origin TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        copied_from TEXT,
        state TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1,
        field_versions TEXT NOT NULL,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX builds_hash ON builds (content_hash)",
      `CREATE TABLE item_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        items TEXT NOT NULL,
        allow_copy INTEGER NOT NULL DEFAULT 1,
        origin TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        copied_from TEXT,
        state TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1,
        field_versions TEXT NOT NULL,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE UNIQUE INDEX item_groups_name ON item_groups (name_key) WHERE deleted_at IS NULL",
      "CREATE INDEX item_groups_hash ON item_groups (content_hash)",
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        version INTEGER NOT NULL,
        changed_at INTEGER NOT NULL,
        deleted_at INTEGER,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE changes (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        version INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (kind, id)
      )`,
      "CREATE UNIQUE INDEX changes_seq ON changes (seq)",
      `CREATE TABLE mutations (id TEXT PRIMARY KEY, result TEXT NOT NULL, at INTEGER NOT NULL)`,
      "CREATE INDEX mutations_at ON mutations (at)",
      `CREATE TABLE plans (
        plan_id TEXT PRIMARY KEY,
        relation TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        name TEXT,
        map_key TEXT,
        updated_at INTEGER,
        rev INTEGER,
        content_hash TEXT,
        since INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      )`,
      "CREATE INDEX plans_hash ON plans (content_hash)",
      "CREATE TABLE plan_creations (at INTEGER NOT NULL)",
      "CREATE INDEX plan_creations_at ON plan_creations (at)",
      `CREATE TABLE links (
        code TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        access TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        admin_revoked INTEGER NOT NULL DEFAULT 0,
        paused_at INTEGER,
        opens INTEGER NOT NULL DEFAULT 0,
        copies INTEGER NOT NULL DEFAULT 0
      )`,
      "CREATE INDEX links_target ON links (target_type, target_id)",
      `CREATE TABLE notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        read_at INTEGER
      )`,
      `CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target TEXT NOT NULL,
        method TEXT NOT NULL,
        args TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER NOT NULL
      )`,
      `CREATE TABLE deletion_steps (step TEXT PRIMARY KEY, done_at INTEGER)`,
    ],
  },
];

const HOUR_MS = 60 * 60_000;
const DISPLAY_NAME_PATTERN = /^[^\u0000-\u001f\u007f\u2028\u2029<>]{2,32}$/;

/** Link expiry choices (§7.5). */
export const VIEW_LINK_EXPIRY_DAYS = [1, 7, 30] as const;

export interface LinkRow {
  code: string;
  targetType: "build" | "item_group";
  targetId: string;
  access: "view" | "copy";
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  pausedAt: number | null;
  opens: number;
  copies: number;
  status: "active" | "expired" | "revoked" | "paused";
}

export interface LinkSnapshot {
  access: "view" | "copy";
  targetType: "build" | "item_group";
  targetId: string;
  allowCopy: boolean;
  ownerDisplayName: string;
  snapshot: BuildValue | GroupValue;
}

export interface OutboxItem {
  id: number;
  target: string;
  method: string;
  args: unknown[];
  attempts: number;
}

export interface PlanSummary {
  name: string;
  mapKey: string;
  rev: number;
  updatedAt: number;
}

type BuildRow = {
  id: string;
  name: string;
  weapon_id: string;
  data: string;
  allow_copy: number;
  origin: Origin;
  content_hash: string;
  copied_from: string | null;
  state: string;
  version: number;
  field_versions: string;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
};

type GroupRow = Omit<BuildRow, "weapon_id" | "data"> & { name_key: string; items: string };

type SettingRow = { key: string; value: string; version: number; changed_at: number; deleted_at: number | null; updated_at: number };

type PlanRow = {
  plan_id: string;
  relation: "owned" | "shared";
  role: Role;
  status: "pending" | "active";
  name: string | null;
  map_key: string | null;
  updated_at: number | null;
  rev: number | null;
  content_hash: string | null;
  since: number;
  version: number;
};

function byteLength(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

function buildValueOf(row: BuildRow): BuildValue {
  const data = JSON.parse(row.data) as { root: BuildValue["root"]; ammoId?: string };
  return { name: row.name, weaponId: row.weapon_id, root: data.root, ...(data.ammoId ? { ammoId: data.ammoId } : {}) };
}

function buildRecord(row: BuildRow): BuildRecord {
  return {
    kind: "build",
    id: row.id,
    version: row.version,
    ...buildValueOf(row),
    allowCopy: row.allow_copy === 1,
    origin: row.origin,
    copiedFrom: row.copied_from,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deleted_at !== null ? { deleted: true } : {}),
  };
}

function groupRecord(row: GroupRow): GroupRecord {
  return {
    kind: "item_group",
    id: row.id,
    version: row.version,
    name: row.name,
    items: JSON.parse(row.items) as string[],
    allowCopy: row.allow_copy === 1,
    origin: row.origin,
    copiedFrom: row.copied_from,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deleted_at !== null ? { deleted: true } : {}),
  };
}

function settingRecord(row: SettingRow): SettingRecord {
  return {
    kind: "setting",
    id: row.key,
    version: row.version,
    value: JSON.parse(row.value) as unknown,
    changedAt: row.changed_at,
    updatedAt: row.updated_at,
    ...(row.deleted_at !== null ? { deleted: true } : {}),
  };
}

function planRecord(row: PlanRow): PlanIndexRecord {
  return {
    kind: "plan",
    id: row.plan_id,
    version: row.version,
    relation: row.relation,
    role: row.role,
    status: row.status,
    name: row.name,
    mapKey: row.map_key,
    updatedAt: row.updated_at,
    rev: row.rev,
    since: row.since,
  };
}

/** Checks a build as the gun builder does, plus a non-empty name; returns the value as stored. */
export function checkBuildValue(value: unknown): BuildValue {
  const candidate = value as Partial<BuildValue> | null;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.name !== "string" ||
    !candidate.name.trim() ||
    !isGunBuild({ ...candidate, id: "build", createdAt: 0, updatedAt: 0 })
  ) {
    throw invalid("That isn't a valid build.");
  }
  return {
    name: candidate.name.trim(),
    weaponId: candidate.weaponId!,
    root: candidate.root!,
    ...(candidate.ammoId ? { ammoId: candidate.ammoId } : {}),
  };
}

export function checkGroupValue(value: unknown): GroupValue {
  if (!isGroup(value)) throw invalid("That isn't a valid item group.");
  return { name: value.name.trim(), items: [...new Set(value.items)] };
}

export class UserStore {
  constructor(
    private readonly sql: Sql,
    private readonly transaction: (work: () => void) => void,
    private readonly now: () => number = Date.now
  ) {}

  migrate() {
    return migrate(this.sql, USER_MIGRATIONS, this.transaction);
  }

  private atomically<T>(work: () => T): T {
    let result: T;
    this.transaction(() => {
      result = work();
    });
    return result!;
  }

  // Meta

  private meta(key: string): number {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row ? Number(row.value) : 0;
  }

  private setMeta(key: string, value: number) {
    this.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));
  }

  seq() {
    return this.meta("seq");
  }

  private recordChange(kind: LibraryKind, id: string, version: number, deleted: boolean) {
    const seq = this.seq() + 1;
    this.setMeta("seq", seq);
    this.sql.exec(
      `INSERT INTO changes (kind, id, seq, version, deleted) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind, id) DO UPDATE SET seq = excluded.seq, version = excluded.version, deleted = excluded.deleted`,
      kind,
      id,
      seq,
      version,
      deleted ? 1 : 0
    );
  }

  // Profile

  /** Creates the profile on first use, with a generated display name so no real name shows by default. */
  ensureProfile(userId: string, random: () => number = Math.random) {
    const row = this.sql.exec<{ user_id: string }>("SELECT user_id FROM profile WHERE id = 1").toArray()[0];
    if (row) return;
    const name = `Scav-${String(Math.floor(random() * 9000) + 1000)}`;
    this.sql.exec("INSERT INTO profile (id, user_id, display_name, state, created_at) VALUES (1, ?, ?, 'active', ?)", userId, name, this.now());
  }

  profile(): { userId: string; displayName: string; state: "active" | "deleting"; createdAt: number } | null {
    const row = this.sql
      .exec<{ user_id: string; display_name: string; state: "active" | "deleting"; created_at: number }>(
        "SELECT user_id, display_name, state, created_at FROM profile WHERE id = 1"
      )
      .toArray()[0];
    return row ? { userId: row.user_id, displayName: row.display_name, state: row.state, createdAt: row.created_at } : null;
  }

  displayName() {
    return this.profile()?.displayName ?? "Unknown";
  }

  setDisplayName(name: string) {
    const trimmed = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
    if (!DISPLAY_NAME_PATTERN.test(trimmed)) throw invalid("Display names are 2 to 32 characters, without < or >.");
    this.requireActive();
    this.sql.exec("UPDATE profile SET display_name = ? WHERE id = 1", trimmed);
    return trimmed;
  }

  private requireActive() {
    if (this.profile()?.state === "deleting") throw forbidden("This account is being deleted.");
  }

  isDeleting() {
    return this.profile()?.state === "deleting";
  }

  // Buckets

  chargeBudget(key: string, limit: BucketLimit, cost: number, refundOnDenial: number): RequestBudget {
    const now = this.now();
    const row = this.sql.exec<{ tokens: number; updated_at: number }>("SELECT tokens, updated_at FROM budgets WHERE key = ?", key).toArray()[0];
    const bucket = row ? { tokens: row.tokens, updatedAt: row.updated_at } : { tokens: limit.burst, updatedAt: now };
    const result = consumeTokens(bucket, limit, now, cost, refundOnDenial);
    this.sql.exec(
      "INSERT INTO budgets (key, tokens, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at",
      key,
      bucket.tokens,
      bucket.updatedAt
    );
    return result;
  }

  /** Takes `cost` tokens from one of the per-user rate buckets, or throws rate_limited. */
  charge(rate: UserRate, cost = 1) {
    const result = this.chargeBudget(`rate:${rate}`, USER_RATES[rate], cost, 0);
    if (!result.allowed) {
      throw new DomainError("rate_limited", "Too many requests. Try again shortly.", { retryAfterSeconds: result.retryAfterSeconds });
    }
  }

  /** Gives tokens back, when the work they paid for was refused for another reason. */
  refund(rate: UserRate, cost = 1) {
    this.chargeBudget(`rate:${rate}`, USER_RATES[rate], -cost, 0);
  }

  // Counts

  usage(): Usage {
    const count = (query: string) => this.sql.exec<{ n: number }>(query).one().n;
    return {
      ownedPlans: count("SELECT COUNT(*) AS n FROM plans WHERE relation = 'owned'"),
      sharedPlans: count("SELECT COUNT(*) AS n FROM plans WHERE relation = 'shared'"),
      builds: count("SELECT COUNT(*) AS n FROM builds WHERE deleted_at IS NULL"),
      itemGroups: count("SELECT COUNT(*) AS n FROM item_groups WHERE deleted_at IS NULL"),
    };
  }

  private requireRoom(kind: "builds" | "itemGroups" | "ownedPlans" | "sharedPlans") {
    const used = this.usage()[kind];
    const limit = USER_LIMITS[kind];
    if (used >= limit) {
      const message = {
        builds: LIMIT_MESSAGES.builds,
        itemGroups: LIMIT_MESSAGES.itemGroups,
        ownedPlans: LIMIT_MESSAGES.ownedPlans,
        sharedPlans: LIMIT_MESSAGES.sharedPlans,
      }[kind];
      throw limitError(overLimitMessage(message, used, limit), { limit, used, kind });
    }
  }

  // Snapshot and changes

  library(): LibrarySnapshot {
    const builds = this.sql.exec<BuildRow>("SELECT * FROM builds WHERE deleted_at IS NULL ORDER BY updated_at DESC").toArray();
    const groups = this.sql.exec<GroupRow>("SELECT * FROM item_groups WHERE deleted_at IS NULL ORDER BY name_key").toArray();
    const settings = this.sql.exec<SettingRow>("SELECT * FROM settings WHERE deleted_at IS NULL").toArray();
    const plans = this.sql.exec<PlanRow>("SELECT * FROM plans ORDER BY updated_at DESC").toArray();
    return {
      seq: this.seq(),
      records: [...builds.map(buildRecord), ...groups.map(groupRecord), ...settings.map(settingRecord), ...plans.map(planRecord)],
      usage: this.usage(),
      limits: { ownedPlans: USER_LIMITS.ownedPlans, sharedPlans: USER_LIMITS.sharedPlans, builds: USER_LIMITS.builds, itemGroups: USER_LIMITS.itemGroups },
      notices: this.notices(),
      hashes: {
        builds: builds.map((row) => row.content_hash),
        itemGroups: groups.map((row) => row.content_hash),
        plans: plans.flatMap((row) => (row.content_hash && row.relation === "owned" ? [row.content_hash] : [])),
      },
      displayName: this.displayName(),
    };
  }

  /** Records and tombstones changed after `since`, or resync when a purged deletion may have been missed. */
  changesSince(since: number): ChangesResult {
    if (!Number.isSafeInteger(since) || since < 0 || since > this.seq()) return { resync: true };
    if (since < this.meta("floor_seq")) return { resync: true };
    const rows = this.sql
      .exec<{ kind: LibraryKind; id: string; version: number; deleted: number }>("SELECT kind, id, version, deleted FROM changes WHERE seq > ? ORDER BY seq", since)
      .toArray();
    const records: LibraryRecord[] = [];
    const tombstones: { kind: LibraryKind; id: string; version: number }[] = [];
    for (const row of rows) {
      const record = row.deleted ? null : this.record(row.kind, row.id);
      if (record) records.push(record);
      else tombstones.push({ kind: row.kind, id: row.id, version: row.version });
    }
    return { seq: this.seq(), records, tombstones };
  }

  /** One record, live or tombstoned, or null. */
  record(kind: LibraryKind, id: string): LibraryRecord | null {
    if (kind === "build") {
      const row = this.sql.exec<BuildRow>("SELECT * FROM builds WHERE id = ?", id).toArray()[0];
      return row ? buildRecord(row) : null;
    }
    if (kind === "item_group") {
      const row = this.sql.exec<GroupRow>("SELECT * FROM item_groups WHERE id = ?", id).toArray()[0];
      return row ? groupRecord(row) : null;
    }
    if (kind === "setting") {
      const row = this.sql.exec<SettingRow>("SELECT * FROM settings WHERE key = ?", id).toArray()[0];
      return row ? settingRecord(row) : null;
    }
    const row = this.sql.exec<PlanRow>("SELECT * FROM plans WHERE plan_id = ?", id).toArray()[0];
    return row ? planRecord(row) : null;
  }

  // Mutations

  /**
   * Applies a batch of mutations in order, each in its own transaction, so one refusal never undoes
   * the others. A mutation id seen before returns the stored result: replays are harmless.
   */
  applyMutations(mutations: readonly Mutation[], origin: Origin = "created"): MutationResult[] {
    if (!Array.isArray(mutations) || mutations.length > USER_LIMITS.batchSize) {
      throw invalid(`Send at most ${USER_LIMITS.batchSize} mutations per request.`);
    }
    this.requireActive();
    return mutations.map((mutation) => this.applyOne(mutation, origin));
  }

  private applyOne(mutation: Mutation, origin: Origin): MutationResult {
    const mutationId = typeof mutation?.mutationId === "string" && mutation.mutationId.length <= 64 ? mutation.mutationId : null;
    if (!mutationId) return { mutationId: String(mutation?.mutationId ?? ""), status: "rejected", code: "invalid", message: "Each mutation needs a mutationId." };
    const stored = this.sql.exec<{ result: string }>("SELECT result FROM mutations WHERE id = ?", mutationId).toArray()[0];
    if (stored) return JSON.parse(stored.result) as MutationResult;

    const budget = this.chargeBudget(`rate:libraryWrites`, USER_RATES.libraryWrites, 1, 0);
    if (!budget.allowed) {
      return { mutationId, status: "rejected", code: "rate_limited", message: "Too many changes at once. Try again shortly.", details: { retryAfterSeconds: budget.retryAfterSeconds } };
    }
    let result: MutationResult;
    try {
      result = this.atomically(() => {
        const outcome = this.dispatch(mutation, mutationId, origin);
        // Conflicts aren't stored: the same mutation re-sent after the person chooses must run again.
        if (outcome.status !== "conflict") {
          this.sql.exec("INSERT INTO mutations (id, result, at) VALUES (?, ?, ?)", mutationId, JSON.stringify(outcome), this.now());
        }
        return outcome;
      });
    } catch (error) {
      if (error instanceof DomainError) {
        const code = error.code === "limit" || error.code === "forbidden" || error.code === "rate_limited" || error.code === "gone" ? error.code : "invalid";
        result = { mutationId, status: "rejected", code, message: error.message, details: error.details as never };
      } else if (error instanceof PatchError) {
        result = { mutationId, status: "rejected", code: "invalid", message: error.message };
      } else {
        throw error;
      }
    }
    return result;
  }

  private dispatch(mutation: Mutation, mutationId: string, origin: Origin): MutationResult {
    const { kind, op } = mutation;
    if (kind === "setting") {
      if (op === "patch") return this.patchSetting(mutationId, mutation.id, mutation.baseVersion, mutation.patch);
      if (op === "delete") return this.deleteSetting(mutationId, mutation.id, mutation.baseVersion);
      throw invalid("Settings are created with a patch.");
    }
    if (kind !== "build" && kind !== "item_group") throw invalid("Unknown record kind.");
    if (op === "create") {
      const record =
        kind === "build"
          ? this.createBuild(mutation.id, mutation.value as BuildValue, { origin })
          : this.createGroup(mutation.id, mutation.value as GroupValue, { origin, renameOnClash: false });
      return { mutationId, status: "applied", version: record.version, record, merged: false };
    }
    if (op === "patch") {
      return kind === "build"
        ? this.patchBuild(mutationId, mutation.id, mutation.baseVersion, mutation.patch as BuildPatch)
        : this.patchGroup(mutationId, mutation.id, mutation.baseVersion, mutation.patch as GroupPatch);
    }
    if (op === "delete") return this.deleteRecord(mutationId, kind, mutation.id, mutation.baseVersion);
    throw invalid("Unknown mutation.");
  }

  private requireNewId(table: "builds" | "item_groups", id: string) {
    if (!isRecordId(id)) throw invalid("That id isn't valid.");
    if (this.sql.exec(`SELECT 1 FROM ${table} WHERE id = ?`, id).toArray().length > 0) {
      throw invalid("That id is already used. Create it again under a new id.", { reason: "id_taken" });
    }
  }

  createBuild(id: string, value: unknown, options: { origin: Origin; copiedFrom?: string | null; allowCopy?: boolean }): BuildRecord {
    this.requireNewId("builds", id);
    const build = checkBuildValue(value);
    this.requireRoom("builds");
    const data = JSON.stringify({ root: build.root, ...(build.ammoId ? { ammoId: build.ammoId } : {}) });
    const bytes = byteLength(data);
    if (bytes > USER_LIMITS.entryBytes) throw limitError(LIMIT_MESSAGES.entrySize);
    const now = this.now();
    this.sql.exec(
      `INSERT INTO builds (id, name, weapon_id, data, bytes, allow_copy, origin, content_hash, copied_from, version, field_versions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      id,
      build.name,
      build.weaponId,
      data,
      bytes,
      options.allowCopy === false ? 0 : 1,
      options.origin,
      buildHash(build),
      options.copiedFrom ?? null,
      JSON.stringify(initialBuildFieldVersions(build)),
      now,
      now
    );
    this.recordChange("build", id, 1, false);
    return this.record("build", id) as BuildRecord;
  }

  createGroup(id: string, value: unknown, options: { origin: Origin; copiedFrom?: string | null; renameOnClash: boolean; suffix?: string }): GroupRecord {
    this.requireNewId("item_groups", id);
    const group = checkGroupValue(value);
    this.requireRoom("itemGroups");
    const taken = (key: string) => this.sql.exec("SELECT 1 FROM item_groups WHERE name_key = ? AND deleted_at IS NULL", key).toArray().length > 0;
    let name = group.name;
    if (taken(name.toLowerCase())) {
      if (!options.renameOnClash) throw invalid("A group with this name already exists.", { reason: "name_taken" });
      name = uniqueGroupName(group.name, taken, MAX_GROUP_NAME_LENGTH, options.suffix);
    }
    const items = JSON.stringify(group.items);
    if (byteLength(items) > USER_LIMITS.entryBytes) throw limitError(LIMIT_MESSAGES.entrySize);
    const now = this.now();
    const stored = { name, items: group.items };
    this.sql.exec(
      `INSERT INTO item_groups (id, name, name_key, items, allow_copy, origin, content_hash, copied_from, version, field_versions, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?, ?)`,
      id,
      name,
      name.toLowerCase(),
      items,
      options.origin,
      groupHash(stored),
      options.copiedFrom ?? null,
      JSON.stringify(initialGroupFieldVersions(stored)),
      now,
      now
    );
    this.recordChange("item_group", id, 1, false);
    return this.record("item_group", id) as GroupRecord;
  }

  private patchBuild(mutationId: string, id: string, baseVersion: number, patch: BuildPatch): MutationResult {
    const row = this.sql.exec<BuildRow>("SELECT * FROM builds WHERE id = ?", id).toArray()[0];
    if (!row) throw new DomainError("gone", "That build no longer exists on the server.");
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0 || baseVersion > row.version) throw invalid("That base version isn't valid.");
    if (!patch || typeof patch !== "object") throw invalid("A patch is required.");
    const restored = row.deleted_at !== null;
    const fieldVersions = JSON.parse(row.field_versions) as Record<string, number>;
    if (!restored && baseVersion < row.version) {
      const fields = clashingBuildFields(patch, fieldVersions, baseVersion);
      if (fields.length > 0) return { mutationId, status: "conflict", fields, mine: patch, theirs: { version: row.version, record: buildRecord(row) } };
    }
    const next = checkBuildValue(applyBuildPatch(buildValueOf(row), patch));
    if (next.weaponId !== row.weapon_id) throw invalid("A build's weapon can't change.");
    const data = JSON.stringify({ root: next.root, ...(next.ammoId ? { ammoId: next.ammoId } : {}) });
    const bytes = byteLength(data);
    if (bytes > USER_LIMITS.entryBytes) throw limitError(LIMIT_MESSAGES.entrySize);
    const version = row.version + 1;
    this.sql.exec(
      `UPDATE builds SET name = ?, data = ?, bytes = ?, content_hash = ?, version = ?, field_versions = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`,
      next.name,
      data,
      bytes,
      buildHash(next),
      version,
      JSON.stringify(nextBuildFieldVersions(fieldVersions, patch, version)),
      this.now(),
      id
    );
    this.recordChange("build", id, version, false);
    if (restored) this.addNotice("restored", `"${next.name}" was restored because it was edited on another device.`);
    return {
      mutationId,
      status: "applied",
      version,
      record: this.record("build", id)!,
      merged: !restored && baseVersion < row.version,
      ...(restored ? { restored: true } : {}),
    };
  }

  private patchGroup(mutationId: string, id: string, baseVersion: number, patch: GroupPatch): MutationResult {
    const row = this.sql.exec<GroupRow>("SELECT * FROM item_groups WHERE id = ?", id).toArray()[0];
    if (!row) throw new DomainError("gone", "That item group no longer exists on the server.");
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0 || baseVersion > row.version) throw invalid("That base version isn't valid.");
    if (!patch || typeof patch !== "object") throw invalid("A patch is required.");
    if ((patch.add && !Array.isArray(patch.add)) || (patch.remove && !Array.isArray(patch.remove))) throw invalid("add and remove are lists of item names.");
    const restored = row.deleted_at !== null;
    const fieldVersions = JSON.parse(row.field_versions) as Record<string, number>;
    if (!restored && baseVersion < row.version) {
      const fields = clashingGroupFields(patch, fieldVersions, baseVersion);
      if (fields.length > 0) return { mutationId, status: "conflict", fields, mine: patch, theirs: { version: row.version, record: groupRecord(row) } };
    }
    const current = groupRecord(row);
    let next = checkGroupValue(applyGroupPatch({ name: current.name, items: current.items }, patch));
    const taken = (key: string) =>
      this.sql.exec("SELECT 1 FROM item_groups WHERE name_key = ? AND deleted_at IS NULL AND id <> ?", key, id).toArray().length > 0;
    // A rename to a name another group took meanwhile is settled without asking.
    if (taken(next.name.toLowerCase())) next = { ...next, name: uniqueGroupName(next.name, taken, MAX_GROUP_NAME_LENGTH) };
    const items = JSON.stringify(next.items);
    if (byteLength(items) > USER_LIMITS.entryBytes) throw limitError(LIMIT_MESSAGES.entrySize);
    const version = row.version + 1;
    this.sql.exec(
      `UPDATE item_groups SET name = ?, name_key = ?, items = ?, content_hash = ?, version = ?, field_versions = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`,
      next.name,
      next.name.toLowerCase(),
      items,
      groupHash(next),
      version,
      JSON.stringify(nextGroupFieldVersions(fieldVersions, patch, version, next.items)),
      this.now(),
      id
    );
    this.recordChange("item_group", id, version, false);
    if (restored) this.addNotice("restored", `"${next.name}" was restored because it was edited on another device.`);
    return {
      mutationId,
      status: "applied",
      version,
      record: this.record("item_group", id)!,
      merged: !restored && baseVersion < row.version,
      ...(restored ? { restored: true } : {}),
    };
  }

  /** A delete never destroys edits its device hasn't seen: a stale base version is a conflict. */
  private deleteRecord(mutationId: string, kind: "build" | "item_group", id: string, baseVersion: number): MutationResult {
    const table = kind === "build" ? "builds" : "item_groups";
    const row = this.sql.exec<{ version: number; deleted_at: number | null }>(`SELECT version, deleted_at FROM ${table} WHERE id = ?`, id).toArray()[0];
    if (!row) throw new DomainError("gone", "That no longer exists on the server.");
    const record = this.record(kind, id)!;
    if (row.deleted_at !== null) return { mutationId, status: "applied", version: row.version, record, merged: false };
    if (baseVersion !== row.version) return { mutationId, status: "conflict", fields: ["*"], mine: null, theirs: { version: row.version, record } };
    const version = row.version + 1;
    this.sql.exec(`UPDATE ${table} SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`, this.now(), version, this.now(), id);
    this.revokeLinksOf(kind, id);
    this.recordChange(kind, id, version, true);
    return { mutationId, status: "applied", version, record: this.record(kind, id)!, merged: false };
  }

  private patchSetting(mutationId: string, key: string, baseVersion: number, patch: SettingPatch): MutationResult {
    if (!isSettingKey(key)) throw invalid("That setting isn't synced.");
    if (!patch || typeof patch !== "object" || !Number.isSafeInteger(patch.changedAt) || patch.changedAt < 0) throw invalid("A setting change needs a value and changedAt.");
    const value = JSON.stringify(patch.value ?? null);
    if (byteLength(value) > USER_LIMITS.settingBytes) throw limitError(`A setting can be at most ${USER_LIMITS.settingBytes / 1024} KB.`);
    const row = this.sql.exec<SettingRow>("SELECT * FROM settings WHERE key = ?", key).toArray()[0];
    const now = this.now();
    if (!row) {
      this.sql.exec("INSERT INTO settings (key, value, version, changed_at, updated_at) VALUES (?, ?, 1, ?, ?)", key, value, patch.changedAt, now);
      this.recordChange("setting", key, 1, false);
      return { mutationId, status: "applied", version: 1, record: this.record("setting", key)!, merged: false };
    }
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0 || baseVersion > row.version) throw invalid("That base version isn't valid.");
    const stale = baseVersion < row.version;
    if (isConflictingSettingKey(key)) {
      // Quest progress is real work: a clash on the same quest asks Keep mine / Keep theirs.
      if (stale && row.deleted_at === null && row.value !== value) {
        return { mutationId, status: "conflict", fields: [key], mine: patch, theirs: { version: row.version, record: settingRecord(row) } };
      }
    } else if (stale && row.changed_at > patch.changedAt) {
      // Preferences: the newest change wins, so an older change arriving late leaves it as it is.
      return { mutationId, status: "applied", version: row.version, record: settingRecord(row), merged: true };
    }
    const version = row.version + 1;
    this.sql.exec(
      "UPDATE settings SET value = ?, version = ?, changed_at = ?, deleted_at = NULL, updated_at = ? WHERE key = ?",
      value,
      version,
      patch.changedAt,
      now,
      key
    );
    this.recordChange("setting", key, version, false);
    return { mutationId, status: "applied", version, record: this.record("setting", key)!, merged: stale };
  }

  private deleteSetting(mutationId: string, key: string, baseVersion: number): MutationResult {
    if (!isSettingKey(key)) throw invalid("That setting isn't synced.");
    const row = this.sql.exec<SettingRow>("SELECT * FROM settings WHERE key = ?", key).toArray()[0];
    if (!row) throw new DomainError("gone", "That setting isn't on the server.");
    if (row.deleted_at !== null) return { mutationId, status: "applied", version: row.version, record: settingRecord(row), merged: false };
    if (baseVersion !== row.version && isConflictingSettingKey(key)) {
      return { mutationId, status: "conflict", fields: [key], mine: null, theirs: { version: row.version, record: settingRecord(row) } };
    }
    const version = row.version + 1;
    this.sql.exec("UPDATE settings SET deleted_at = ?, version = ?, updated_at = ? WHERE key = ?", this.now(), version, this.now(), key);
    this.recordChange("setting", key, version, true);
    return { mutationId, status: "applied", version, record: this.record("setting", key)!, merged: false };
  }

  setAllowCopy(kind: "build" | "item_group", id: string, allowCopy: boolean) {
    this.requireActive();
    const table = kind === "build" ? "builds" : "item_groups";
    const row = this.sql.exec<{ version: number }>(`SELECT version FROM ${table} WHERE id = ? AND deleted_at IS NULL`, id).toArray()[0];
    if (!row) throw notFound();
    const version = row.version + 1;
    this.sql.exec(`UPDATE ${table} SET allow_copy = ?, version = ?, updated_at = ? WHERE id = ?`, allowCopy ? 1 : 0, version, this.now(), id);
    this.recordChange(kind, id, version, false);
    return this.record(kind, id)!;
  }

  // Imports and copies

  /**
   * Migration and restore (§14.5): each build or group is created under a new id, unless its
   * content hash is already in the library (then it is a duplicate, so retries are safe). Draws on
   * the daily import bucket, not the library-writes bucket.
   */
  importItem(item: { type: "build" | "item_group"; id: string; value: unknown }, origin: "migration" | "restore") {
    this.requireActive();
    return this.atomically((): { status: "created"; record: LibraryRecord } | { status: "duplicate"; id: string } => {
      if (item.type === "build") {
        const build = checkBuildValue(item.value);
        const existing = this.sql.exec<{ id: string }>("SELECT id FROM builds WHERE content_hash = ? AND deleted_at IS NULL", buildHash(build)).toArray()[0];
        if (existing) return { status: "duplicate", id: existing.id };
        this.requireRoom("builds");
        this.charge("imports");
        return { status: "created", record: this.createBuild(item.id, build, { origin }) };
      }
      const group = checkGroupValue(item.value);
      const existing = this.sql.exec<{ id: string }>("SELECT id FROM item_groups WHERE content_hash = ? AND deleted_at IS NULL", groupHash(group)).toArray()[0];
      if (existing) return { status: "duplicate", id: existing.id };
      this.requireRoom("itemGroups");
      this.charge("imports");
      return { status: "created", record: this.createGroup(item.id, group, { origin, renameOnClash: true, suffix: "(from browser)" }) };
    });
  }

  /** Saves a copy from a link or an agent: a new item with the copier's own "Allow copies" default. */
  createCopy(kind: "build" | "item_group", id: string, value: unknown, copiedFrom: string, rate: UserRate | null = "acceptsAndCopies") {
    this.requireActive();
    return this.atomically(() => {
      if (rate) this.charge(rate);
      const name = String((value as { name?: unknown })?.name ?? "").slice(0, 120);
      return kind === "build"
        ? this.createBuild(id, value, { origin: "copy", copiedFrom: copiedFrom.slice(0, 120) || name })
        : this.createGroup(id, value, { origin: "copy", copiedFrom: copiedFrom.slice(0, 120) || name, renameOnClash: true });
    });
  }

  // Plan index

  plans(): PlanIndexRecord[] {
    return this.sql.exec<PlanRow>("SELECT * FROM plans ORDER BY updated_at DESC").toArray().map(planRecord);
  }

  planEntry(planId: string): PlanIndexRecord | null {
    const row = this.sql.exec<PlanRow>("SELECT * FROM plans WHERE plan_id = ?", planId).toArray()[0];
    return row ? planRecord(row) : null;
  }

  private bumpPlan(planId: string) {
    const row = this.sql.exec<{ version: number }>("SELECT version FROM plans WHERE plan_id = ?", planId).toArray()[0];
    if (row) this.recordChange("plan", planId, row.version, false);
  }

  /**
   * Reserves an owned-plan slot before PlanDO.init (reserve, act, confirm). Created and copied plans
   * count toward the hourly rate; imports instead draw on the daily import bucket and are skipped
   * when an owned plan already has the same content.
   */
  reservePlan(planId: string, options: { kind: "create" | "copy" | "import" | "offline-copy"; contentHash?: string; name?: string; mapKey?: string }) {
    this.requireActive();
    return this.atomically((): { status: "reserved" } | { status: "duplicate"; planId: string } => {
      if (this.planEntry(planId)) throw invalid("That plan id is already used.", { reason: "id_taken" });
      if (options.kind === "import" && options.contentHash) {
        const existing = this.sql
          .exec<{ plan_id: string }>("SELECT plan_id FROM plans WHERE content_hash = ? AND relation = 'owned'", options.contentHash)
          .toArray()[0];
        if (existing) return { status: "duplicate", planId: existing.plan_id };
      }
      this.requireRoom("ownedPlans");
      const now = this.now();
      if (options.kind === "import") {
        this.charge("imports");
      } else {
        this.sql.exec("DELETE FROM plan_creations WHERE at <= ?", now - HOUR_MS);
        const recent = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM plan_creations").one().n;
        if (recent >= USER_LIMITS.plansCreatedPerHour) throw limitError(LIMIT_MESSAGES.planRate, { limit: USER_LIMITS.plansCreatedPerHour, used: recent, kind: "planRate" });
        this.sql.exec("INSERT INTO plan_creations (at) VALUES (?)", now);
      }
      this.sql.exec(
        `INSERT INTO plans (plan_id, relation, role, status, name, map_key, updated_at, rev, content_hash, since, version)
         VALUES (?, 'owned', 'owner', 'pending', ?, ?, ?, 0, ?, ?, 1)`,
        planId,
        options.name ?? null,
        options.mapKey ?? null,
        now,
        options.contentHash ?? null,
        now
      );
      return { status: "reserved" };
    });
  }

  /** Marks a reservation done, with the plan's summary; the plan then shows on every device. */
  confirmPlan(planId: string, summary: PlanSummary) {
    this.sql.exec(
      "UPDATE plans SET status = 'active', name = ?, map_key = ?, rev = ?, updated_at = ?, version = version + 1 WHERE plan_id = ?",
      summary.name,
      summary.mapKey,
      summary.rev,
      summary.updatedAt,
      planId
    );
    this.bumpPlan(planId);
    return this.planEntry(planId);
  }

  /** Releases a reservation whose PlanDO call failed. Never touches an active entry. */
  releasePlan(planId: string) {
    this.sql.exec("DELETE FROM plans WHERE plan_id = ? AND status = 'pending'", planId);
  }

  /** Reserves a shared-plan slot before PlanDO.acceptInvite. A plan already in the index needs no slot. */
  reserveShared(planId: string) {
    this.requireActive();
    return this.atomically((): { status: "reserved" | "member" } => {
      const existing = this.planEntry(planId);
      if (existing && existing.status === "active") return { status: "member" };
      if (existing) return { status: "reserved" };
      this.requireRoom("sharedPlans");
      const now = this.now();
      this.sql.exec(
        "INSERT INTO plans (plan_id, relation, role, status, since, updated_at, version) VALUES (?, 'shared', 'viewer', 'pending', ?, ?, 1)",
        planId,
        now,
        now
      );
      return { status: "reserved" };
    });
  }

  /** Sets the user's role and summary for a plan they belong to (join, role change, rename, transfer). */
  setPlanEntry(planId: string, entry: { role: Role; summary?: Partial<PlanSummary> }) {
    const relation = entry.role === "owner" ? "owned" : "shared";
    const now = this.now();
    const existing = this.planEntry(planId);
    if (existing) {
      this.sql.exec(
        `UPDATE plans SET relation = ?, role = ?, status = 'active', name = COALESCE(?, name), map_key = COALESCE(?, map_key),
           rev = COALESCE(?, rev), updated_at = COALESCE(?, updated_at), version = version + 1 WHERE plan_id = ?`,
        relation,
        entry.role,
        entry.summary?.name ?? null,
        entry.summary?.mapKey ?? null,
        entry.summary?.rev ?? null,
        entry.summary?.updatedAt ?? null,
        planId
      );
    } else {
      this.sql.exec(
        `INSERT INTO plans (plan_id, relation, role, status, name, map_key, updated_at, rev, since, version) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, 1)`,
        planId,
        relation,
        entry.role,
        entry.summary?.name ?? null,
        entry.summary?.mapKey ?? null,
        entry.summary?.updatedAt ?? now,
        entry.summary?.rev ?? 0,
        now
      );
    }
    this.bumpPlan(planId);
    return this.planEntry(planId)!;
  }

  /**
   * A plan handed to this user, by an explicit transfer or because its owner left. Always accepted,
   * even past the owned-plan limit, unless this account is being deleted.
   */
  receiveOwnership(planId: string, summary: Partial<PlanSummary>, notice: string | null) {
    if (this.isDeleting()) throw forbidden("This account is being deleted.");
    const entry = this.setPlanEntry(planId, { role: "owner", summary });
    if (notice) this.addNotice("ownership", notice);
    return entry;
  }

  /** The plan's latest name, map and rev for listing; ignored for plans not in the index. */
  touchPlan(planId: string, summary: Partial<PlanSummary> & { role?: Role }) {
    const existing = this.planEntry(planId);
    if (!existing || existing.status !== "active") return;
    if (summary.role && summary.role !== existing.role) {
      this.setPlanEntry(planId, { role: summary.role, summary });
      return;
    }
    this.sql.exec(
      `UPDATE plans SET name = COALESCE(?, name), map_key = COALESCE(?, map_key), rev = COALESCE(?, rev), updated_at = COALESCE(?, updated_at),
         version = version + 1 WHERE plan_id = ?`,
      summary.name ?? null,
      summary.mapKey ?? null,
      summary.rev ?? null,
      summary.updatedAt ?? null,
      planId
    );
    this.bumpPlan(planId);
  }

  /** Removes a plan from the index (left, removed, deleted), with an optional notice. */
  forgetPlan(planId: string, notice?: string) {
    const existing = this.planEntry(planId);
    if (!existing) return;
    this.sql.exec("DELETE FROM plans WHERE plan_id = ?", planId);
    this.recordChange("plan", planId, existing.version + 1, true);
    if (notice) this.addNotice("plan", notice);
  }

  /** Pending rows, which may be stale: reconciled with their PlanDOs before refusing at a limit. */
  pendingPlans(): string[] {
    return this.sql.exec<{ plan_id: string }>("SELECT plan_id FROM plans WHERE status = 'pending'").toArray().map((row) => row.plan_id);
  }

  /** Every plan the index lists in a relation, for reconciliation at a limit. */
  planIds(relation: "owned" | "shared"): string[] {
    return this.sql.exec<{ plan_id: string }>("SELECT plan_id FROM plans WHERE relation = ?", relation).toArray().map((row) => row.plan_id);
  }

  // Links to builds and item groups

  private linkStatus(row: { expires_at: number | null; revoked_at: number | null; paused_at: number | null }): LinkRow["status"] {
    if (row.revoked_at !== null) return "revoked";
    if (row.expires_at !== null && row.expires_at <= this.now()) return "expired";
    if (row.paused_at !== null) return "paused";
    return "active";
  }

  createLink(code: string, target: { type: "build" | "item_group"; id: string }, access: "view" | "copy", expiresInDays: number | null) {
    this.requireActive();
    if (access !== "view" && access !== "copy") throw invalid("Builds and item groups have view and copy links.");
    if (expiresInDays !== null && !VIEW_LINK_EXPIRY_DAYS.includes(expiresInDays as never)) throw invalid("Links expire after 1, 7 or 30 days, or never.");
    return this.atomically(() => {
      const table = target.type === "build" ? "builds" : "item_groups";
      if (!this.sql.exec(`SELECT 1 FROM ${table} WHERE id = ? AND deleted_at IS NULL`, target.id).toArray().length) throw notFound();
      const active = this.listLinks(target.type, target.id).filter((link) => link.status === "active" || link.status === "paused").length;
      if (active >= USER_LIMITS.linksPerItem) {
        throw limitError(`An item can have at most ${USER_LIMITS.linksPerItem} active links. Revoke one first.`, { limit: USER_LIMITS.linksPerItem, used: active });
      }
      this.charge("linkCreation");
      const now = this.now();
      const expiresAt = expiresInDays === null ? null : now + expiresInDays * 24 * HOUR_MS;
      this.sql.exec(
        "INSERT INTO links (code, target_type, target_id, access, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        code,
        target.type,
        target.id,
        access,
        now,
        expiresAt
      );
      return this.link(code)!;
    });
  }

  link(code: string): LinkRow | null {
    const row = this.sql
      .exec<{
        code: string;
        target_type: "build" | "item_group";
        target_id: string;
        access: "view" | "copy";
        created_at: number;
        expires_at: number | null;
        revoked_at: number | null;
        paused_at: number | null;
        opens: number;
        copies: number;
      }>("SELECT * FROM links WHERE code = ?", code)
      .toArray()[0];
    if (!row) return null;
    return {
      code: row.code,
      targetType: row.target_type,
      targetId: row.target_id,
      access: row.access,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      pausedAt: row.paused_at,
      opens: row.opens,
      copies: row.copies,
      status: this.linkStatus(row),
    };
  }

  listLinks(type: "build" | "item_group", id: string): LinkRow[] {
    return this.sql
      .exec<{ code: string }>("SELECT code FROM links WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC", type, id)
      .toArray()
      .map((row) => this.link(row.code)!);
  }

  revokeLink(code: string, admin = false) {
    const link = this.link(code);
    if (!link) throw notFound("That link doesn't exist.");
    if (link.revokedAt === null) this.sql.exec("UPDATE links SET revoked_at = ?, admin_revoked = ? WHERE code = ?", this.now(), admin ? 1 : 0, code);
    return this.link(code)!;
  }

  private revokeLinksOf(kind: "build" | "item_group", id: string) {
    this.sql.exec("UPDATE links SET revoked_at = ? WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL", this.now(), kind, id);
  }

  setLinkPaused(code: string, paused: boolean) {
    if (!this.link(code)) return null;
    this.sql.exec("UPDATE links SET paused_at = ? WHERE code = ?", paused ? this.now() : null, code);
    return this.link(code);
  }

  /** What a /s/ link shows: checks revoked, expired, paused and deleted; counts the open. */
  openLink(code: string, options: { count: boolean; asOwner?: boolean } = { count: true }): LinkSnapshot {
    const link = this.link(code);
    if (!link) throw notFound("That link doesn't exist.");
    const adminRevoked = this.sql.exec<{ admin_revoked: number }>("SELECT admin_revoked FROM links WHERE code = ?", code).one().admin_revoked === 1;
    if (link.status === "revoked") throw new DomainError("gone", adminRevoked ? "This link was removed after review." : "This link was revoked.");
    if (link.status === "expired") throw new DomainError("gone", "This link has expired.");
    if (this.isDeleting()) throw new DomainError("gone", "This link no longer works.");
    if (link.status === "paused" && !options.asOwner) throw new DomainError("forbidden", "This link is under review.", { reason: "paused" });
    const record = this.record(link.targetType, link.targetId) as BuildRecord | GroupRecord | null;
    if (!record || record.deleted) throw new DomainError("gone", "The item behind this link was deleted.");
    const table = link.targetType === "build" ? "builds" : "item_groups";
    const state = this.sql.exec<{ state: string }>(`SELECT state FROM ${table} WHERE id = ?`, link.targetId).one().state;
    if (state === "disabled" && !options.asOwner) throw new DomainError("gone", "This item was removed after review.");
    if (options.count) this.sql.exec("UPDATE links SET opens = opens + 1 WHERE code = ?", code);
    const snapshot: BuildValue | GroupValue =
      record.kind === "build"
        ? { name: record.name, weaponId: record.weaponId, root: record.root, ...(record.ammoId ? { ammoId: record.ammoId } : {}) }
        : { name: record.name, items: record.items };
    return {
      // Copy links act as view links while "Allow copies" is off.
      access: link.access === "copy" && record.allowCopy ? "copy" : "view",
      targetType: link.targetType,
      targetId: link.targetId,
      allowCopy: record.allowCopy,
      ownerDisplayName: this.displayName(),
      snapshot,
    };
  }

  /** The content for a copy through a link: only for copy links with "Allow copies" on. */
  exportForLink(code: string): LinkSnapshot {
    const opened = this.openLink(code, { count: false });
    if (opened.access !== "copy") throw forbidden("The owner doesn't allow copies of this.");
    this.sql.exec("UPDATE links SET copies = copies + 1 WHERE code = ?", code);
    return opened;
  }

  /** Moderation: hides an item from everyone but its owner. */
  setItemState(kind: "build" | "item_group", id: string, state: "active" | "disabled") {
    const table = kind === "build" ? "builds" : "item_groups";
    this.sql.exec(`UPDATE ${table} SET state = ? WHERE id = ?`, state, id);
  }

  // Notices

  addNotice(kind: string, body: string): Notice {
    const now = this.now();
    this.sql.exec("INSERT INTO notices (kind, body, created_at) VALUES (?, ?, ?)", kind, body.slice(0, 500), now);
    const id = this.sql.exec<{ id: number }>("SELECT last_insert_rowid() AS id").one().id;
    return { id, kind, body, createdAt: now };
  }

  notices(): Notice[] {
    return this.sql
      .exec<{ id: number; kind: string; body: string; created_at: number }>("SELECT id, kind, body, created_at FROM notices WHERE read_at IS NULL ORDER BY id DESC LIMIT 50")
      .toArray()
      .map((row) => ({ id: row.id, kind: row.kind, body: row.body, createdAt: row.created_at }));
  }

  markNoticesRead(ids: readonly number[]) {
    for (const id of ids.slice(0, 100)) this.sql.exec("UPDATE notices SET read_at = ? WHERE id = ? AND read_at IS NULL", this.now(), id);
  }

  // Outbox

  enqueue(target: string, method: string, args: unknown[], delayMs = 0) {
    this.sql.exec("INSERT INTO outbox (target, method, args, next_at) VALUES (?, ?, ?, ?)", target, method, JSON.stringify(args), this.now() + delayMs);
  }

  dueOutbox(limit = 20): OutboxItem[] {
    return this.sql
      .exec<{ id: number; target: string; method: string; args: string; attempts: number }>(
        "SELECT id, target, method, args, attempts FROM outbox WHERE next_at <= ? ORDER BY next_at LIMIT ?",
        this.now(),
        limit
      )
      .toArray()
      .map((row) => ({ id: row.id, target: row.target, method: row.method, args: JSON.parse(row.args) as unknown[], attempts: row.attempts }));
  }

  outboxDone(id: number) {
    this.sql.exec("DELETE FROM outbox WHERE id = ?", id);
  }

  /** Backs off: 10 s, 20 s, 40 s… up to an hour; gives up after 20 attempts. */
  outboxRetry(id: number) {
    const row = this.sql.exec<{ attempts: number }>("SELECT attempts FROM outbox WHERE id = ?", id).toArray()[0];
    if (!row) return;
    if (row.attempts >= 20) {
      this.outboxDone(id);
      return;
    }
    const delay = Math.min(HOUR_MS, 10_000 * 2 ** row.attempts);
    this.sql.exec("UPDATE outbox SET attempts = attempts + 1, next_at = ? WHERE id = ?", this.now() + delay, id);
  }

  // Alarm sweep

  /**
   * The alarm's housekeeping: releases pending plan reservations older than 10 minutes, purges
   * tombstones, idempotency records and dead links after 30 days (raising floor_seq past purged
   * changes), and queues LinkDO cleanup. Returns when it next has work, or null.
   */
  sweep(): number | null {
    const now = this.now();
    this.transaction(() => {
      this.sql.exec("DELETE FROM plans WHERE status = 'pending' AND since <= ?", now - PENDING_RESERVATION_MS);
      const cutoff = now - RETENTION_MS;
      let floor = this.meta("floor_seq");
      for (const [table, kind] of [
        ["builds", "build"],
        ["item_groups", "item_group"],
      ] as const) {
        const purged = this.sql.exec<{ id: string }>(`SELECT id FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at <= ?`, cutoff).toArray();
        for (const { id } of purged) {
          const change = this.sql.exec<{ seq: number }>("SELECT seq FROM changes WHERE kind = ? AND id = ?", kind, id).toArray()[0];
          if (change) floor = Math.max(floor, change.seq);
          this.sql.exec("DELETE FROM changes WHERE kind = ? AND id = ?", kind, id);
          this.sql.exec(`DELETE FROM ${table} WHERE id = ?`, id);
          for (const link of this.sql.exec<{ code: string }>("SELECT code FROM links WHERE target_type = ? AND target_id = ?", kind, id).toArray()) {
            this.enqueue(`link:${link.code}`, "destroy", []);
          }
          this.sql.exec("DELETE FROM links WHERE target_type = ? AND target_id = ?", kind, id);
        }
      }
      const settings = this.sql.exec<{ key: string }>("SELECT key FROM settings WHERE deleted_at IS NOT NULL AND deleted_at <= ?", cutoff).toArray();
      for (const { key } of settings) {
        const change = this.sql.exec<{ seq: number }>("SELECT seq FROM changes WHERE kind = 'setting' AND id = ?", key).toArray()[0];
        if (change) floor = Math.max(floor, change.seq);
        this.sql.exec("DELETE FROM changes WHERE kind = 'setting' AND id = ?", key);
        this.sql.exec("DELETE FROM settings WHERE key = ?", key);
      }
      this.setMeta("floor_seq", floor);
      this.sql.exec("DELETE FROM mutations WHERE at <= ?", cutoff);
      const deadLinks = this.sql
        .exec<{ code: string }>("SELECT code FROM links WHERE (revoked_at IS NOT NULL AND revoked_at <= ?) OR (expires_at IS NOT NULL AND expires_at <= ?)", cutoff, cutoff)
        .toArray();
      for (const { code } of deadLinks) {
        this.enqueue(`link:${code}`, "destroy", []);
        this.sql.exec("DELETE FROM links WHERE code = ?", code);
      }
      this.sql.exec("DELETE FROM notices WHERE read_at IS NOT NULL AND read_at <= ?", cutoff);
    });
    return this.nextDue();
  }

  /** The earliest time the alarm has work: the outbox, a pending reservation, a tombstone or dead link expiring. */
  nextDue(): number | null {
    const times = [
      this.sql.exec<{ t: number | null }>("SELECT MIN(next_at) AS t FROM outbox").one().t,
      this.sql.exec<{ t: number | null }>("SELECT MIN(since) + ? AS t FROM plans WHERE status = 'pending'", PENDING_RESERVATION_MS).one().t,
      this.sql.exec<{ t: number | null }>("SELECT MIN(deleted_at) + ? AS t FROM builds WHERE deleted_at IS NOT NULL", RETENTION_MS).one().t,
      this.sql.exec<{ t: number | null }>("SELECT MIN(deleted_at) + ? AS t FROM item_groups WHERE deleted_at IS NOT NULL", RETENTION_MS).one().t,
      this.sql.exec<{ t: number | null }>("SELECT MIN(deleted_at) + ? AS t FROM settings WHERE deleted_at IS NOT NULL", RETENTION_MS).one().t,
      this.sql.exec<{ t: number | null }>("SELECT MIN(at) + ? AS t FROM mutations", RETENTION_MS).one().t,
      this.sql.exec<{ t: number | null }>("SELECT MIN(COALESCE(revoked_at, expires_at)) + ? AS t FROM links WHERE revoked_at IS NOT NULL OR expires_at IS NOT NULL", RETENTION_MS).one().t,
    ].filter((time): time is number => typeof time === "number");
    return times.length > 0 ? Math.min(...times) : null;
  }

  // Account deletion (§14.4)

  beginDeletion() {
    this.sql.exec("UPDATE profile SET state = 'deleting' WHERE id = 1");
  }

  deletionStepDone(step: string) {
    return this.sql.exec<{ done_at: number | null }>("SELECT done_at FROM deletion_steps WHERE step = ?", step).toArray()[0]?.done_at != null;
  }

  markDeletionStep(step: string) {
    this.sql.exec("INSERT INTO deletion_steps (step, done_at) VALUES (?, ?) ON CONFLICT(step) DO UPDATE SET done_at = excluded.done_at", step, this.now());
  }

  /** Step 2: revokes every link and deletes builds and groups; returns link codes for LinkDO cleanup. */
  deleteLibraryContent(): string[] {
    const codes = this.sql.exec<{ code: string }>("SELECT code FROM links").toArray().map((row) => row.code);
    this.transaction(() => {
      this.sql.exec("DELETE FROM links");
      this.sql.exec("DELETE FROM builds");
      this.sql.exec("DELETE FROM item_groups");
      this.sql.exec("DELETE FROM settings");
    });
    return codes;
  }

  /** Record kinds whose rows the client can write directly. */
  static readonly RECORD_KINDS: readonly RecordKind[] = ["build", "item_group", "setting"];
}
