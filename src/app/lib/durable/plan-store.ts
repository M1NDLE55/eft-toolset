import { applyOps, contentOf, docFromContent, OpError, type PlanDoc, type PlanOp } from "@/app/lib/sharing/plan-doc";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import type { Role } from "@/app/lib/sharing/types";
import { PLAN_LIMITS, RETENTION_MS } from "./limits";
import { DomainError, forbidden, invalid, limitError, migrate, notFound, type Migration, type Sql } from "./sql";
import { sha256Hex } from "@/app/lib/sharing/sha256";

/**
 * One raid plan, inside its Durable Object (PlanDO): content as one row per waypoint, drawing and
 * note (so an op writes a few rows, not the whole plan), members and roles, links and invites, and
 * the recent op log for reconnect catch-up. It is the plan's only writer, so ops apply one at a time
 * in arrival order, which defines "last" for last-writer-wins (§11.4, §11.5).
 */
export const PLAN_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE plan (id INTEGER PRIMARY KEY CHECK (id = 1), plan_id TEXT NOT NULL, content TEXT NOT NULL, bytes INTEGER NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE members (user_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')), added_at INTEGER NOT NULL)`,
    ],
  },
  {
    // Version 1 was never written by any feature (no plan was ever stored), so it is replaced.
    version: 2,
    statements: [
      "DROP TABLE plan",
      "DROP TABLE members",
      `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE TABLE plan (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        plan_id TEXT NOT NULL,
        name TEXT NOT NULL,
        map_key TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        allow_copy INTEGER NOT NULL DEFAULT 0,
        rev INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',
        copied_from TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE layers (layer_id TEXT PRIMARY KEY)`,
      `CREATE TABLE waypoints (id TEXT PRIMARY KEY, ord TEXT NOT NULL, x REAL NOT NULL, z REAL NOT NULL, y REAL, rev INTEGER NOT NULL, by TEXT)`,
      "CREATE INDEX waypoints_ord ON waypoints (ord, id)",
      `CREATE TABLE drawings (id TEXT PRIMARY KEY, kind TEXT NOT NULL, color TEXT NOT NULL, points TEXT NOT NULL, n_points INTEGER NOT NULL, rev INTEGER NOT NULL, by TEXT)`,
      `CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        x REAL NOT NULL, z REAL NOT NULL, y REAL,
        title TEXT NOT NULL, body TEXT NOT NULL, color TEXT NOT NULL,
        title_rev INTEGER NOT NULL, body_rev INTEGER NOT NULL,
        rev INTEGER NOT NULL, by TEXT
      )`,
      `CREATE TABLE members (
        user_id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        display_name TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        invited_by TEXT,
        via_link TEXT
      )`,
      `CREATE TABLE links (
        code TEXT PRIMARY KEY,
        access TEXT NOT NULL,
        role TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        max_uses INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        revoked_at INTEGER,
        admin_revoked INTEGER NOT NULL DEFAULT 0,
        paused_at INTEGER
      )`,
      `CREATE TABLE op_log (
        rev INTEGER PRIMARY KEY,
        op_id TEXT NOT NULL UNIQUE,
        actor_id TEXT,
        via TEXT NOT NULL,
        client TEXT,
        ops TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        at INTEGER NOT NULL
      )`,
      `CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, method TEXT NOT NULL, args TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL)`,
    ],
  },
];

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
/** How often members' plan indexes get the plan's latest rev (renames go at once). */
export const SUMMARY_INTERVAL_MS = 10 * 60_000;
export const INVITE_EXPIRY_DAYS = [1 / 24, 1, 7, 30];
export const VIEW_EXPIRY_DAYS = [1, 7, 30];

export interface Actor {
  id: string | null;
  name: string;
  via: "web" | "mcp";
  client?: string;
}

export interface Member {
  userId: string;
  role: Role;
  displayName: string;
  joinedAt: number;
}

/**
 * A member as other members see them (§16.2): a display name, a role, and a key that identifies them
 * within this plan only. User ids are never shown to anyone but their owner.
 */
export interface PublicMember {
  key: string;
  role: Role;
  displayName: string;
  joinedAt: number;
  you: boolean;
}

/** A member's key in a plan: stable, opaque, different in every plan. */
export function memberKey(planId: string, userId: string) {
  return sha256Hex(`member:${planId}:${userId}`).slice(0, 16);
}

export interface PlanSummary {
  name: string;
  mapKey: string;
  rev: number;
  updatedAt: number;
}

export interface PlanSnapshot {
  planId: string;
  rev: number;
  doc: PlanDoc;
  role: Role | "anonymous";
  allowCopy: boolean;
  state: "active" | "disabled";
  createdAt: number;
  updatedAt: number;
  ownerKey: string;
  members?: PublicMember[];
}

export interface Batch {
  rev: number;
  opId: string;
  actor: Actor;
  ops: PlanOp[];
}

export interface PlanLink {
  code: string;
  access: "view" | "copy" | "invite";
  role: "editor" | "viewer" | null;
  createdBy: string;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
  status: "active" | "expired" | "revoked" | "paused" | "used";
}

type LinkRow = {
  code: string;
  access: "view" | "copy" | "invite";
  role: "editor" | "viewer" | null;
  created_by: string;
  created_at: number;
  expires_at: number | null;
  max_uses: number | null;
  uses: number;
  revoked_at: number | null;
  admin_revoked: number;
  paused_at: number | null;
};

const ROLE_RANK: Record<Role, number> = { owner: 3, editor: 2, viewer: 1 };

export class PlanStore {
  private cached: { rev: number; doc: PlanDoc } | null = null;

  constructor(
    private readonly sql: Sql,
    private readonly transaction: (work: () => void) => void,
    private readonly now: () => number = () => Date.now()
  ) {}

  migrate() {
    return migrate(this.sql, PLAN_MIGRATIONS, this.transaction);
  }

  private atomically<T>(work: () => T): T {
    let result: T;
    try {
      this.transaction(() => {
        result = work();
      });
    } catch (error) {
      // A rolled-back write may have touched the cached document's rev; re-read it next time.
      this.cached = null;
      throw error;
    }
    return result!;
  }

  private meta(key: string): number {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row ? Number(row.value) : 0;
  }

  private setMeta(key: string, value: number) {
    this.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));
  }

  exists() {
    return this.sql.exec("SELECT 1 FROM plan WHERE id = 1").toArray().length > 0;
  }

  /** After deleteAll: the empty schema again, and nothing cached. */
  reset() {
    this.cached = null;
    this.migrate();
  }

  private planRow() {
    const row = this.sql
      .exec<{
        plan_id: string;
        name: string;
        map_key: string;
        owner_id: string;
        allow_copy: number;
        rev: number;
        bytes: number;
        state: "active" | "disabled";
        created_at: number;
        updated_at: number;
      }>("SELECT * FROM plan WHERE id = 1")
      .toArray()[0];
    if (!row) throw notFound();
    return row;
  }

  // Content

  /** The whole document, read from the rows once per wake and kept while the object is awake. */
  doc(): { rev: number; doc: PlanDoc } {
    const plan = this.planRow();
    if (this.cached && this.cached.rev === plan.rev) return this.cached;
    const doc: PlanDoc = { name: plan.name, mapKey: plan.map_key, layers: [], waypoints: {}, drawings: {}, notes: {} };
    doc.layers = this.sql.exec<{ layer_id: string }>("SELECT layer_id FROM layers").toArray().map((row) => row.layer_id);
    for (const row of this.sql.exec<{ id: string; ord: string; x: number; z: number; y: number | null; rev: number; by: string | null }>("SELECT * FROM waypoints").toArray()) {
      doc.waypoints[row.id] = { id: row.id, ord: row.ord, x: row.x, z: row.z, ...(row.y === null ? {} : { y: row.y }), rev: row.rev, by: row.by };
    }
    for (const row of this.sql.exec<{ id: string; kind: "pen" | "arrow"; color: string; points: string; rev: number; by: string | null }>("SELECT * FROM drawings").toArray()) {
      doc.drawings[row.id] = { id: row.id, kind: row.kind, color: row.color, points: JSON.parse(row.points) as PlanDoc["drawings"][string]["points"], rev: row.rev, by: row.by };
    }
    for (const row of this.sql
      .exec<{ id: string; x: number; z: number; y: number | null; title: string; body: string; color: string; title_rev: number; body_rev: number; rev: number; by: string | null }>(
        "SELECT * FROM notes"
      )
      .toArray()) {
      doc.notes[row.id] = {
        id: row.id,
        x: row.x,
        z: row.z,
        ...(row.y === null ? {} : { y: row.y }),
        title: row.title,
        body: row.body,
        color: row.color,
        titleRev: row.title_rev,
        bodyRev: row.body_rev,
        rev: row.rev,
        by: row.by,
      };
    }
    this.cached = { rev: plan.rev, doc };
    return this.cached;
  }

  /** Writes the rows a batch changed. */
  private writeRows(doc: PlanDoc, changed: Set<string>) {
    for (const key of changed) {
      if (key === "plan") continue;
      if (key === "layers") {
        this.sql.exec("DELETE FROM layers");
        for (const layer of doc.layers) this.sql.exec("INSERT INTO layers (layer_id) VALUES (?)", layer);
        continue;
      }
      const separator = key.indexOf(":");
      const kind = key.slice(0, separator);
      const id = key.slice(separator + 1);
      if (kind === "wp") {
        const row = doc.waypoints[id];
        if (!row) this.sql.exec("DELETE FROM waypoints WHERE id = ?", id);
        else {
          this.sql.exec(
            "INSERT INTO waypoints (id, ord, x, z, y, rev, by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ord = excluded.ord, x = excluded.x, z = excluded.z, y = excluded.y, rev = excluded.rev, by = excluded.by",
            row.id,
            row.ord,
            row.x,
            row.z,
            row.y ?? null,
            row.rev,
            row.by
          );
        }
      } else if (kind === "draw") {
        const row = doc.drawings[id];
        if (!row) this.sql.exec("DELETE FROM drawings WHERE id = ?", id);
        else {
          this.sql.exec(
            "INSERT INTO drawings (id, kind, color, points, n_points, rev, by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            row.id,
            row.kind,
            row.color,
            JSON.stringify(row.points),
            row.points.length,
            row.rev,
            row.by
          );
        }
      } else if (kind === "note") {
        const row = doc.notes[id];
        if (!row) this.sql.exec("DELETE FROM notes WHERE id = ?", id);
        else {
          this.sql.exec(
            `INSERT INTO notes (id, x, z, y, title, body, color, title_rev, body_rev, rev, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET x = excluded.x, z = excluded.z, y = excluded.y, title = excluded.title, body = excluded.body, color = excluded.color,
               title_rev = excluded.title_rev, body_rev = excluded.body_rev, rev = excluded.rev, by = excluded.by`,
            row.id,
            row.x,
            row.z,
            row.y ?? null,
            row.title,
            row.body,
            row.color,
            row.titleRev,
            row.bodyRev,
            row.rev,
            row.by
          );
        }
      }
    }
  }

  /**
   * Stores a new plan with its owner. Refuses an id that already holds a plan, so a client can't claim
   * someone else's by guessing; content is checked against every cap.
   */
  init(planId: string, owner: { id: string; name: string }, content: PlanContent, options: { allowCopy?: boolean; copiedFrom?: string | null } = {}): PlanSummary {
    if (this.exists()) throw invalid("That plan id is already used.", { reason: "id_taken" });
    let doc: PlanDoc;
    try {
      doc = docFromContent(content, owner.id, 0);
    } catch (error) {
      if (error instanceof OpError) throw new DomainError(error.code === "limit" ? "limit" : "invalid", error.message, error.details);
      throw error;
    }
    const now = this.now();
    this.atomically(() => {
      this.sql.exec(
        `INSERT INTO plan (id, plan_id, name, map_key, owner_id, allow_copy, rev, bytes, state, copied_from, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, ?)`,
        planId,
        doc.name,
        doc.mapKey,
        owner.id,
        options.allowCopy ? 1 : 0,
        new TextEncoder().encode(JSON.stringify(contentOf(doc))).byteLength,
        options.copiedFrom ?? null,
        now,
        now
      );
      const changed = new Set<string>(["layers", ...Object.keys(doc.waypoints).map((id) => `wp:${id}`), ...Object.keys(doc.drawings).map((id) => `draw:${id}`), ...Object.keys(doc.notes).map((id) => `note:${id}`)]);
      this.writeRows(doc, changed);
      this.sql.exec("INSERT INTO members (user_id, role, display_name, joined_at) VALUES (?, 'owner', ?, ?)", owner.id, owner.name, now);
    });
    this.cached = { rev: 0, doc };
    return this.summary();
  }

  summary(): PlanSummary {
    const plan = this.planRow();
    return { name: plan.name, mapKey: plan.map_key, rev: plan.rev, updatedAt: plan.updated_at };
  }

  // Access

  role(userId: string | null): Role | null {
    if (!userId) return null;
    return this.sql.exec<{ role: Role }>("SELECT role FROM members WHERE user_id = ?", userId).toArray()[0]?.role ?? null;
  }

  /** The member's role, or not_found (never forbidden, so plan ids don't reveal that a plan exists). */
  requireMember(userId: string, allowed: readonly Role[] = ["owner", "editor", "viewer"]): Role {
    if (!this.exists()) throw notFound("That plan doesn't exist, or isn't shared with you.");
    const role = this.role(userId);
    if (!role) throw notFound("That plan doesn't exist, or isn't shared with you.");
    const plan = this.planRow();
    if (plan.state === "disabled" && role !== "owner") throw new DomainError("gone", "This plan was removed after review.");
    if (!allowed.includes(role)) throw forbidden(role === "viewer" ? "Viewers can't change this plan." : "Only the plan's owner can do that.");
    return role;
  }

  members(): Member[] {
    return this.sql
      .exec<{ user_id: string; role: Role; display_name: string; joined_at: number }>(
        "SELECT user_id, role, display_name, joined_at FROM members ORDER BY CASE role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END DESC, joined_at"
      )
      .toArray()
      .map((row) => ({ userId: row.user_id, role: row.role, displayName: row.display_name, joinedAt: row.joined_at }));
  }

  publicMembers(viewerId: string | null): PublicMember[] {
    const planId = this.planRow().plan_id;
    return this.members().map((member) => ({
      key: memberKey(planId, member.userId),
      role: member.role,
      displayName: member.displayName,
      joinedAt: member.joinedAt,
      you: member.userId === viewerId,
    }));
  }

  /** The user behind a member key, or not_found. */
  userForKey(key: string): string {
    const planId = this.planRow().plan_id;
    const member = this.members().find((candidate) => memberKey(planId, candidate.userId) === key);
    if (!member) throw notFound("They aren't a member of this plan.");
    return member.userId;
  }

  memberName(userId: string | null): string {
    if (!userId) return "Someone";
    return this.sql.exec<{ display_name: string }>("SELECT display_name FROM members WHERE user_id = ?", userId).toArray()[0]?.display_name ?? "Someone";
  }

  /** The document as members see it: who last changed each item is a member key, never a user id. */
  publicDoc(doc: PlanDoc): PlanDoc {
    const planId = this.planRow().plan_id;
    const key = (by: string | null) => (by ? memberKey(planId, by) : null);
    const map = <T extends { by: string | null }>(rows: Record<string, T>) => Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, { ...row, by: key(row.by) }]));
    return { ...doc, waypoints: map(doc.waypoints), drawings: map(doc.drawings), notes: map(doc.notes) };
  }

  snapshot(userId: string | null, options: { asLink?: boolean } = {}): PlanSnapshot {
    const role = options.asLink ? (this.role(userId) ?? "anonymous") : this.requireMember(userId ?? "");
    const plan = this.planRow();
    const { rev, doc } = this.doc();
    return {
      planId: plan.plan_id,
      rev,
      doc: this.publicDoc(doc),
      role,
      allowCopy: plan.allow_copy === 1,
      state: plan.state,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
      ownerKey: memberKey(plan.plan_id, plan.owner_id),
      ...(role !== "anonymous" ? { members: this.publicMembers(userId) } : {}),
    };
  }

  // Ops

  /**
   * Applies a batch for an editor or owner, in one transaction (§11.4). A re-sent op id answers with
   * its stored rev and applies nothing. The op log keeps the last 500 batches or 128 KiB.
   */
  apply(actor: Actor & { id: string }, opId: string, ops: unknown[]): { rev: number; ops: PlanOp[]; duplicate: boolean; renamed: boolean } {
    if (typeof opId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(opId)) throw invalid("Each batch needs an opId.");
    if (!Array.isArray(ops) || ops.length === 0) throw invalid("A batch needs at least one op.");
    this.requireMember(actor.id, ["owner", "editor"]);
    const seen = this.sql.exec<{ rev: number; ops: string }>("SELECT rev, ops FROM op_log WHERE op_id = ?", opId).toArray()[0];
    if (seen) return { rev: seen.rev, ops: JSON.parse(seen.ops) as PlanOp[], duplicate: true, renamed: false };
    const { rev: current, doc } = this.doc();
    const rev = current + 1;
    let result: ReturnType<typeof applyOps>;
    try {
      result = applyOps(doc, ops, { rev, by: actor.id });
    } catch (error) {
      if (error instanceof OpError) {
        // A note clash names who changed it: as a member key and display name, never a user id.
        const by = typeof error.details?.by === "string" ? error.details.by : null;
        const details = error.details && "by" in error.details ? { ...error.details, by: by ? memberKey(this.planRow().plan_id, by) : null, byName: this.memberName(by) } : error.details;
        throw new DomainError(error.code, error.message, details);
      }
      throw error;
    }
    const now = this.now();
    const logText = JSON.stringify(result.ops);
    const logBytes = new TextEncoder().encode(logText).byteLength;
    this.atomically(() => {
      this.writeRows(result.doc, result.changed);
      this.sql.exec("UPDATE plan SET name = ?, rev = ?, bytes = ?, updated_at = ? WHERE id = 1", result.doc.name, rev, result.bytes, now);
      this.sql.exec(
        "INSERT INTO op_log (rev, op_id, actor_id, via, client, ops, bytes, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        rev,
        opId,
        actor.id,
        actor.via,
        actor.client ?? null,
        logText,
        logBytes,
        now
      );
      this.trimLog();
      this.setMeta("summary_dirty", 1);
    });
    this.cached = { rev, doc: result.doc };
    return { rev, ops: result.ops, duplicate: false, renamed: result.changed.has("plan") };
  }

  private trimLog() {
    const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM op_log").one().n;
    if (count > PLAN_LIMITS.opLogBatches) {
      this.sql.exec("DELETE FROM op_log WHERE rev <= (SELECT MAX(rev) FROM op_log) - ?", PLAN_LIMITS.opLogBatches);
    }
    let total = this.sql.exec<{ n: number | null }>("SELECT SUM(bytes) AS n FROM op_log").one().n ?? 0;
    while (total > PLAN_LIMITS.opLogBytes) {
      const oldest = this.sql.exec<{ rev: number; bytes: number }>("SELECT rev, bytes FROM op_log ORDER BY rev LIMIT 1").toArray()[0];
      if (!oldest) break;
      this.sql.exec("DELETE FROM op_log WHERE rev = ?", oldest.rev);
      total -= oldest.bytes;
    }
  }

  /** Batches after `since`, or null when the log no longer reaches back that far (send a snapshot). */
  opsSince(since: number): Batch[] | null {
    const { rev } = this.doc();
    if (!Number.isSafeInteger(since) || since < 0 || since > rev) return null;
    if (since === rev) return [];
    const rows = this.sql
      .exec<{ rev: number; op_id: string; actor_id: string | null; via: "web" | "mcp"; client: string | null; ops: string }>("SELECT * FROM op_log WHERE rev > ? ORDER BY rev", since)
      .toArray();
    if (rows.length === 0 || rows[0].rev !== since + 1) return null;
    return rows.map((row) => ({
      rev: row.rev,
      opId: row.op_id,
      actor: { id: row.actor_id ? memberKey(this.planRow().plan_id, row.actor_id) : null, name: this.memberName(row.actor_id), via: row.via, ...(row.client ? { client: row.client } : {}) },
      ops: JSON.parse(row.ops) as PlanOp[],
    }));
  }

  // Settings and moderation

  setAllowCopy(userId: string, allowCopy: boolean) {
    this.requireMember(userId, ["owner"]);
    this.sql.exec("UPDATE plan SET allow_copy = ? WHERE id = 1", allowCopy ? 1 : 0);
    return { allowCopy, name: this.planRow().name };
  }

  setState(state: "active" | "disabled") {
    this.sql.exec("UPDATE plan SET state = ? WHERE id = 1", state);
  }

  state() {
    return this.planRow().state;
  }

  memberRenamed(userId: string, displayName: string) {
    this.sql.exec("UPDATE members SET display_name = ? WHERE user_id = ?", displayName, userId);
  }

  // Members (§8.1, §14.3)

  /** Owner only: makes a member an editor or a viewer. A demoted editor's unused invites are revoked. */
  setRole(ownerId: string, userId: string, role: "editor" | "viewer") {
    this.requireMember(ownerId, ["owner"]);
    if (role !== "editor" && role !== "viewer") throw invalid("The role is editor or viewer.");
    const current = this.role(userId);
    if (!current) throw notFound("They aren't a member of this plan.");
    if (current === "owner") throw invalid("Hand the plan over to change your own role.");
    this.atomically(() => {
      this.sql.exec("UPDATE members SET role = ? WHERE user_id = ?", role, userId);
      if (role === "viewer") this.revokeInvitesBy(userId);
    });
    return this.members();
  }

  /**
   * The owner removes a member, or a member leaves. The owner can't leave here: leaving as owner
   * goes through ownerDeparting, which hands the plan on. Their unused invites are revoked.
   */
  removeMember(actorId: string, userId: string) {
    const role = this.requireMember(actorId);
    if (actorId !== userId && role !== "owner") throw forbidden("Only the plan's owner can remove people.");
    const target = this.role(userId);
    if (!target) throw notFound("They aren't a member of this plan.");
    if (target === "owner") throw invalid("The owner leaves by handing the plan over.", { reason: "owner" });
    this.atomically(() => {
      this.sql.exec("DELETE FROM members WHERE user_id = ?", userId);
      this.revokeInvitesBy(userId);
    });
    return this.members();
  }

  /** A deleted account's membership: removed, and their ops lose their author (content stays). */
  removeDeletedAccount(userId: string) {
    this.atomically(() => {
      this.sql.exec("DELETE FROM members WHERE user_id = ? AND role <> 'owner'", userId);
      this.revokeInvitesBy(userId);
      this.sql.exec("UPDATE op_log SET actor_id = NULL WHERE actor_id = ?", userId);
    });
  }

  private revokeInvitesBy(userId: string) {
    this.sql.exec("UPDATE links SET revoked_at = ? WHERE created_by = ? AND access = 'invite' AND revoked_at IS NULL", this.now(), userId);
  }

  /**
   * The successor when the owner leaves (§14.3): editors before viewers, then who joined first, then
   * the user id so the order is deterministic.
   */
  successors(departingId: string): string[] {
    return this.sql
      .exec<{ user_id: string }>(
        `SELECT user_id FROM members WHERE user_id <> ?
         ORDER BY CASE role WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END DESC, joined_at ASC, user_id ASC`,
        departingId
      )
      .toArray()
      .map((row) => row.user_id);
  }

  /** Checks an explicit transfer before the recipient's index is asked to accept it. */
  checkTransfer(ownerId: string, toUserId: string) {
    this.requireMember(ownerId, ["owner"]);
    if (toUserId === ownerId) throw invalid("You already own this plan.");
    if (!this.role(toUserId)) throw notFound("Share the plan with them before handing it over.");
    return this.summary();
  }

  /**
   * Makes `toUserId` the owner, once their index accepted it. An explicit transfer keeps the former
   * owner as an editor; an owner who leaves (or whose account is deleted) is removed.
   */
  completeTransfer(fromId: string, toUserId: string, mode: "explicit" | "departing") {
    if (this.planRow().owner_id !== fromId) throw forbidden("Only the plan's owner can hand it over.");
    if (!this.role(toUserId)) throw notFound("They aren't a member of this plan.");
    this.atomically(() => {
      this.sql.exec("UPDATE plan SET owner_id = ? WHERE id = 1", toUserId);
      this.sql.exec("UPDATE members SET role = 'owner' WHERE user_id = ?", toUserId);
      if (mode === "explicit") this.sql.exec("UPDATE members SET role = 'editor' WHERE user_id = ?", fromId);
      else {
        this.sql.exec("DELETE FROM members WHERE user_id = ?", fromId);
        this.revokeInvitesBy(fromId);
      }
    });
    return this.members();
  }

  ownerId() {
    return this.planRow().owner_id;
  }

  /** Who had the plan and its link codes, before deleting everything (owner only). */
  prepareDestroy(ownerId: string | null): { members: string[]; codes: string[]; name: string } {
    if (ownerId !== null) this.requireMember(ownerId, ["owner"]);
    return {
      members: this.sql.exec<{ user_id: string }>("SELECT user_id FROM members").toArray().map((row) => row.user_id),
      codes: this.sql.exec<{ code: string }>("SELECT code FROM links").toArray().map((row) => row.code),
      name: this.planRow().name,
    };
  }

  /** A copy of the content, for a member copying the plan: needs "Allow copies" or ownership. */
  exportFor(userId: string): { content: PlanContent; name: string } {
    const role = this.requireMember(userId);
    const plan = this.planRow();
    if (role !== "owner" && plan.allow_copy !== 1) throw forbidden("The owner doesn't allow copies of this plan.");
    return { content: contentOf(this.doc().doc), name: plan.name };
  }

  // Links and invites (§7.5)

  private linkStatus(row: LinkRow): PlanLink["status"] {
    if (row.revoked_at !== null) return "revoked";
    if (row.expires_at !== null && row.expires_at <= this.now()) return "expired";
    if (row.access === "invite" && row.max_uses !== null && row.uses >= row.max_uses) return "used";
    if (row.paused_at !== null) return "paused";
    return "active";
  }

  private linkOf(row: LinkRow): PlanLink {
    return {
      code: row.code,
      access: row.access,
      role: row.role,
      createdBy: row.created_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      maxUses: row.max_uses,
      uses: row.uses,
      status: this.linkStatus(row),
    };
  }

  private linkRow(code: string): LinkRow | null {
    return this.sql.exec<LinkRow>("SELECT * FROM links WHERE code = ?", code).toArray()[0] ?? null;
  }

  /**
   * Owner: any link. Editor: viewer invites only. At most 20 active links per plan, editors' invites
   * included. Invites default to 7 days and one use (up to 50); view and copy links never expire unless asked.
   */
  createLink(userId: string, code: string, options: { access: "view" | "copy" | "invite"; role?: "editor" | "viewer"; expiresIn?: number | null; maxUses?: number }): PlanLink {
    const role = this.requireMember(userId, ["owner", "editor"]);
    const { access } = options;
    if (access !== "view" && access !== "copy" && access !== "invite") throw invalid("access is view, copy or invite.");
    if (role === "editor" && !(access === "invite" && (options.role ?? "viewer") === "viewer")) throw forbidden("Editors can invite viewers only.");
    const inviteRole = access === "invite" ? (options.role ?? "viewer") : null;
    if (inviteRole !== null && inviteRole !== "editor" && inviteRole !== "viewer") throw invalid("Invites are for editors or viewers.");
    let expiresAt: number | null;
    let maxUses: number | null = null;
    const now = this.now();
    if (access === "invite") {
      const days = options.expiresIn ?? 7;
      if (!INVITE_EXPIRY_DAYS.some((choice) => Math.abs(choice - days) < 1e-9)) throw invalid("Invites expire after 1 hour, 1 day, 7 days or 30 days.");
      expiresAt = now + Math.round(days * DAY_MS);
      maxUses = options.maxUses ?? 1;
      if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 50) throw invalid("An invite can be used by 1 to 50 people.");
    } else {
      const days = options.expiresIn ?? null;
      if (days !== null && !VIEW_EXPIRY_DAYS.includes(days)) throw invalid("Links expire after 1, 7 or 30 days, or never.");
      expiresAt = days === null ? null : now + days * DAY_MS;
    }
    return this.atomically(() => {
      const active = this.sql
        .exec<LinkRow>("SELECT * FROM links WHERE revoked_at IS NULL")
        .toArray()
        .filter((row) => ["active", "paused"].includes(this.linkStatus(row))).length;
      if (active >= PLAN_LIMITS.maxActiveLinks) throw limitError(`A plan can have at most ${PLAN_LIMITS.maxActiveLinks} active links. Revoke one first.`, { limit: PLAN_LIMITS.maxActiveLinks, used: active });
      this.sql.exec(
        "INSERT INTO links (code, access, role, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?)",
        code,
        access,
        inviteRole,
        userId,
        now,
        expiresAt,
        maxUses
      );
      return this.linkOf(this.linkRow(code)!);
    });
  }

  /** Owner: every link. Editor: their own invites. Viewers: none. */
  listLinks(userId: string): PlanLink[] {
    const role = this.requireMember(userId, ["owner", "editor"]);
    const rows = this.sql.exec<LinkRow>("SELECT * FROM links ORDER BY created_at DESC").toArray();
    return rows.filter((row) => role === "owner" || (row.access === "invite" && row.created_by === userId)).map((row) => this.linkOf(row));
  }

  /** Owner: any link. Editor: only invites they made. Members who joined stay members. */
  revokeLink(userId: string, code: string, admin = false): PlanLink {
    const row = this.linkRow(code);
    if (!row) throw notFound("That link doesn't exist.");
    if (!admin) {
      const role = this.requireMember(userId, ["owner", "editor"]);
      if (role === "editor" && !(row.access === "invite" && row.created_by === userId)) throw notFound("That link doesn't exist.");
    }
    if (row.revoked_at === null) this.sql.exec("UPDATE links SET revoked_at = ?, admin_revoked = ? WHERE code = ?", this.now(), admin ? 1 : 0, code);
    return this.linkOf(this.linkRow(code)!);
  }

  setLinkPaused(code: string, paused: boolean) {
    if (!this.linkRow(code)) return null;
    this.sql.exec("UPDATE links SET paused_at = ? WHERE code = ?", paused ? this.now() : null, code);
    return this.linkOf(this.linkRow(code)!);
  }

  /** A view or copy link's access, or why it can't be used. The owner always gets in. */
  checkViewLink(code: string, viewerId: string | null): { access: "view" | "copy"; allowCopy: boolean } {
    const row = this.linkRow(code);
    if (!row || row.access === "invite" || !this.exists()) throw notFound("That link doesn't exist.");
    const plan = this.planRow();
    const owner = viewerId !== null && viewerId === plan.owner_id;
    const status = this.linkStatus(row);
    if (status === "revoked") throw new DomainError("gone", row.admin_revoked ? "This link was removed after review." : "This link was revoked.");
    if (status === "expired") throw new DomainError("gone", "This link has expired.");
    if (plan.state === "disabled" && !owner) throw new DomainError("gone", "This plan was removed after review.");
    if (status === "paused" && !owner) throw forbidden("This link is under review.");
    const allowCopy = plan.allow_copy === 1;
    return { access: row.access === "copy" && allowCopy ? "copy" : "view", allowCopy };
  }

  openLink(code: string, viewerId: string | null): { access: "view" | "copy"; allowCopy: boolean; ownerDisplayName: string; plan: PlanContent; rev: number } {
    const checked = this.checkViewLink(code, viewerId);
    const { rev, doc } = this.doc();
    return { ...checked, ownerDisplayName: this.memberName(this.planRow().owner_id), plan: contentOf(doc), rev };
  }

  exportForLink(code: string): { content: PlanContent; name: string } {
    const checked = this.checkViewLink(code, null);
    if (checked.access !== "copy") throw forbidden("The owner doesn't allow copies of this plan.");
    return { content: contentOf(this.doc().doc), name: this.planRow().name };
  }

  private validInvite(code: string): LinkRow {
    const row = this.linkRow(code);
    if (!row || row.access !== "invite" || !this.exists()) throw notFound("That invite doesn't exist.");
    const status = this.linkStatus(row);
    if (status === "revoked") throw new DomainError("gone", "This invite was revoked.");
    if (status === "expired") throw new DomainError("gone", "This invite has expired.");
    if (status === "used") throw new DomainError("gone", "This invite has been used.");
    if (this.planRow().state === "disabled") throw new DomainError("gone", "This plan was removed after review.");
    return row;
  }

  previewInvite(code: string) {
    const row = this.validInvite(code);
    const plan = this.planRow();
    return { planId: plan.plan_id, name: plan.name, mapKey: plan.map_key, role: row.role!, inviter: this.memberName(row.created_by), expiresAt: row.expires_at };
  }

  /**
   * Joins through an invite (§10.3): the use is counted in the same transaction as the membership it
   * creates. Idempotent for members; never lowers a role, and raises one only if the invite's is higher.
   */
  acceptInvite(code: string, user: { id: string; name: string }): { planId: string; role: Role; joined: boolean; summary: PlanSummary } {
    return this.atomically(() => {
      const current = this.role(user.id);
      const plan = this.planRow();
      const link = this.linkRow(code);
      if (current && link?.access === "invite") {
        // Already a member: no use is spent; a higher-role invite raises the role, if still valid.
        if (ROLE_RANK[link.role!] > ROLE_RANK[current]) {
          this.validInvite(code);
          this.sql.exec("UPDATE members SET role = ?, via_link = ? WHERE user_id = ?", link.role, code, user.id);
          this.sql.exec("UPDATE links SET uses = uses + 1 WHERE code = ?", code);
          return { planId: plan.plan_id, role: link.role!, joined: false, summary: this.summary() };
        }
        return { planId: plan.plan_id, role: current, joined: false, summary: this.summary() };
      }
      const row = this.validInvite(code);
      const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").one().n;
      if (count >= PLAN_LIMITS.maxMembers) throw limitError(`A plan can have at most ${PLAN_LIMITS.maxMembers} members.`, { limit: PLAN_LIMITS.maxMembers, used: count });
      this.sql.exec(
        "INSERT INTO members (user_id, role, display_name, joined_at, invited_by, via_link) VALUES (?, ?, ?, ?, ?, ?)",
        user.id,
        row.role,
        user.name,
        this.now(),
        row.created_by,
        code
      );
      this.sql.exec("UPDATE links SET uses = uses + 1 WHERE code = ?", code);
      return { planId: plan.plan_id, role: row.role!, joined: true, summary: this.summary() };
    });
  }

  // Outbox and housekeeping

  enqueue(target: string, method: string, args: unknown[], delayMs = 0) {
    this.sql.exec("INSERT INTO outbox (target, method, args, next_at) VALUES (?, ?, ?, ?)", target, method, JSON.stringify(args), this.now() + delayMs);
  }

  dueOutbox(limit = 20) {
    return this.sql
      .exec<{ id: number; target: string; method: string; args: string; attempts: number }>("SELECT * FROM outbox WHERE next_at <= ? ORDER BY next_at LIMIT ?", this.now(), limit)
      .toArray()
      .map((row) => ({ id: row.id, target: row.target, method: row.method, args: JSON.parse(row.args) as unknown[], attempts: row.attempts }));
  }

  outboxDone(id: number) {
    this.sql.exec("DELETE FROM outbox WHERE id = ?", id);
  }

  outboxRetry(id: number) {
    const row = this.sql.exec<{ attempts: number }>("SELECT attempts FROM outbox WHERE id = ?", id).toArray()[0];
    if (!row) return;
    if (row.attempts >= 20) return this.outboxDone(id);
    this.sql.exec("UPDATE outbox SET attempts = attempts + 1, next_at = ? WHERE id = ?", this.now() + Math.min(HOUR_MS, 10_000 * 2 ** row.attempts), id);
  }

  /**
   * Members' plan indexes learn the plan's name and latest rev (§11.4): at once on a rename, otherwise
   * at most every 10 minutes. Returns whether a push was queued now.
   */
  queueSummary(force: boolean): boolean {
    if (!this.exists()) return false;
    const dirty = this.meta("summary_dirty") === 1;
    if (!dirty && !force) return false;
    const last = this.meta("summary_pushed_at");
    if (!force && this.now() - last < SUMMARY_INTERVAL_MS) return false;
    const summary = this.summary();
    for (const member of this.members()) this.enqueue(`user:${member.userId}`, "touchPlan", [this.planRow().plan_id, { ...summary, role: member.role }]);
    this.setMeta("summary_pushed_at", this.now());
    this.setMeta("summary_dirty", 0);
    return true;
  }

  /** Revoked and expired links are kept 30 days for the owner, then removed; returns codes for LinkDO cleanup. */
  sweepLinks(): string[] {
    if (!this.exists()) return [];
    const cutoff = this.now() - RETENTION_MS;
    const dead = this.sql
      .exec<{ code: string }>("SELECT code FROM links WHERE (revoked_at IS NOT NULL AND revoked_at <= ?) OR (expires_at IS NOT NULL AND expires_at <= ?)", cutoff, cutoff)
      .toArray()
      .map((row) => row.code);
    for (const code of dead) {
      this.sql.exec("DELETE FROM links WHERE code = ?", code);
      this.enqueue(`link:${code}`, "destroy", []);
    }
    return dead;
  }

  /** Links whose expiry has passed (and aren't revoked): their open viewers are closed by the alarm. */
  expiredLinkCodes(): string[] {
    if (!this.exists()) return [];
    return this.sql
      .exec<{ code: string }>("SELECT code FROM links WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?", this.now())
      .toArray()
      .map((row) => row.code);
  }

  nextDue(): number | null {
    const times: number[] = [];
    if (this.exists()) {
      // The next view or copy link to expire, so its open viewers are closed on time.
      const expiring = this.sql
        .exec<{ t: number | null }>("SELECT MIN(expires_at) AS t FROM links WHERE revoked_at IS NULL AND access <> 'invite' AND expires_at > ?", this.now())
        .one().t;
      if (expiring !== null) times.push(expiring);
    }
    const outbox = this.sql.exec<{ t: number | null }>("SELECT MIN(next_at) AS t FROM outbox").one().t;
    if (outbox !== null) times.push(outbox);
    if (this.exists() && this.meta("summary_dirty") === 1) times.push(this.meta("summary_pushed_at") + SUMMARY_INTERVAL_MS);
    if (this.exists()) {
      const link = this.sql
        .exec<{ t: number | null }>("SELECT MIN(COALESCE(revoked_at, expires_at)) AS t FROM links WHERE revoked_at IS NOT NULL OR expires_at IS NOT NULL")
        .one().t;
      if (link !== null) times.push(link + RETENTION_MS);
    }
    return times.length ? Math.min(...times) : null;
  }
}
