import { describePlanProblem, pickPlanFields } from "@/app/lib/raid-planner/plan-validation";
import type { RaidPlan } from "@/app/lib/raid-planner/types";
import { LIMIT_MESSAGES, PLAN_LIMITS } from "./limits";
import { AccessError, LimitError, migrate, type Migration, type Sql } from "./sql";
import type { PlanRole } from "./user-store";

/**
 * One raid plan: its content, its members and their roles. It runs inside the plan's Durable Object
 * (PlanDO). The owner can edit, share and hand the plan over; editors can edit; viewers can read.
 * Indexes of who has which plan live in each member's UserDO and are kept in step by
 * src/app/lib/durable/access.ts.
 */
export const PLAN_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE plan (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        plan_id TEXT NOT NULL,
        content TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE members (
        user_id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
        added_at INTEGER NOT NULL
      )`,
    ],
  },
];

export interface StoredPlan {
  planId: string;
  plan: RaidPlan;
  version: number;
  bytes: number;
  role: PlanRole;
  updatedAt: number;
}

export interface PlanMember {
  userId: string;
  role: PlanRole;
  addedAt: number;
}

/** Checks a plan against the raid planner's limits and the size limit; returns it as stored. */
export function checkPlanContent(value: unknown): { plan: RaidPlan; json: string; bytes: number } {
  const problem = describePlanProblem(value);
  if (problem) throw new LimitError("plan_content", `The plan ${problem}.`);
  const plan = pickPlanFields(value as RaidPlan);
  const json = JSON.stringify(plan);
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > PLAN_LIMITS.maxBytes) throw new LimitError("plan_size", LIMIT_MESSAGES.planSize);
  return { plan, json, bytes };
}

export class PlanStore {
  constructor(
    private readonly sql: Sql,
    private readonly transaction: (work: () => void) => void,
    private readonly now: () => number = Date.now
  ) {}

  migrate() {
    return migrate(this.sql, PLAN_MIGRATIONS, this.transaction);
  }

  exists() {
    return this.sql.exec("SELECT 1 FROM plan WHERE id = 1").toArray().length > 0;
  }

  /** Stores a new plan with its owner. Refuses a plan id that is already taken. */
  create(planId: string, ownerId: string, content: unknown): StoredPlan {
    if (this.exists()) throw new AccessError("That plan already exists.");
    const { plan, json, bytes } = checkPlanContent(content);
    const now = this.now();
    this.transaction(() => {
      this.sql.exec("INSERT INTO plan (id, plan_id, content, bytes, version, created_at, updated_at) VALUES (1, ?, ?, ?, 1, ?, ?)", planId, json, bytes, now, now);
      this.sql.exec("INSERT INTO members (user_id, role, added_at) VALUES (?, 'owner', ?)", ownerId, now);
    });
    return this.read(ownerId);
  }

  role(userId: string): PlanRole | null {
    return this.sql.exec<{ role: PlanRole }>("SELECT role FROM members WHERE user_id = ?", userId).toArray()[0]?.role ?? null;
  }

  read(userId: string): StoredPlan {
    const role = this.requireRole(userId, ["owner", "editor", "viewer"]);
    const row = this.sql
      .exec<{ plan_id: string; content: string; bytes: number; version: number; updated_at: number }>(
        "SELECT plan_id, content, bytes, version, updated_at FROM plan WHERE id = 1"
      )
      .one();
    return { planId: row.plan_id, plan: JSON.parse(row.content) as RaidPlan, version: row.version, bytes: row.bytes, role, updatedAt: row.updated_at };
  }

  /** Replaces the content. With expectedVersion, refuses to overwrite someone else's newer edit. */
  update(userId: string, content: unknown, expectedVersion?: number): StoredPlan {
    this.requireRole(userId, ["owner", "editor"]);
    const current = this.sql.exec<{ version: number }>("SELECT version FROM plan WHERE id = 1").one().version;
    if (expectedVersion !== undefined && expectedVersion !== current) throw new AccessError("The plan changed since you opened it. Reload it and try again.");
    const { json, bytes } = checkPlanContent(content);
    this.sql.exec("UPDATE plan SET content = ?, bytes = ?, version = version + 1, updated_at = ? WHERE id = 1", json, bytes, this.now());
    return this.read(userId);
  }

  members(userId: string): PlanMember[] {
    this.requireRole(userId, ["owner", "editor", "viewer"]);
    return this.sql
      .exec<{ user_id: string; role: PlanRole; added_at: number }>("SELECT user_id, role, added_at FROM members ORDER BY added_at")
      .toArray()
      .map((row) => ({ userId: row.user_id, role: row.role, addedAt: row.added_at }));
  }

  /** The owner adds someone, or changes their role, as an editor or viewer. */
  share(ownerId: string, userId: string, role: Exclude<PlanRole, "owner">) {
    this.requireRole(ownerId, ["owner"]);
    if (userId === ownerId) throw new AccessError("You already own this plan.");
    const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").one().n;
    if (!this.role(userId) && count >= PLAN_LIMITS.maxMembers) {
      throw new AccessError(`A plan can be shared with at most ${PLAN_LIMITS.maxMembers - 1} people.`);
    }
    this.sql.exec(
      "INSERT INTO members (user_id, role, added_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET role = excluded.role",
      userId,
      role,
      this.now()
    );
  }

  /** The owner removes someone, or a member leaves. The owner can't leave without handing the plan over. */
  unshare(actorId: string, userId: string) {
    const role = this.requireRole(actorId, ["owner", "editor", "viewer"]);
    if (actorId !== userId && role !== "owner") throw new AccessError("Only the plan's owner can remove people.");
    if (this.role(userId) === "owner") throw new AccessError("Hand the plan to someone else before leaving it.");
    this.sql.exec("DELETE FROM members WHERE user_id = ?", userId);
  }

  /** Hands the plan to another member, who becomes the owner; the previous owner stays as an editor. */
  transfer(ownerId: string, toUserId: string) {
    this.requireRole(ownerId, ["owner"]);
    if (!this.role(toUserId)) throw new AccessError("Share the plan with them before handing it over.");
    this.transaction(() => {
      this.sql.exec("UPDATE members SET role = 'editor' WHERE user_id = ?", ownerId);
      this.sql.exec("UPDATE members SET role = 'owner' WHERE user_id = ?", toUserId);
    });
  }

  /** Deletes the plan and returns who had it, so their indexes can forget it. Owner only. */
  delete(ownerId: string): string[] {
    this.requireRole(ownerId, ["owner"]);
    const members = this.sql.exec<{ user_id: string }>("SELECT user_id FROM members").toArray().map((row) => row.user_id);
    this.transaction(() => {
      this.sql.exec("DELETE FROM members");
      this.sql.exec("DELETE FROM plan");
    });
    return members;
  }

  private requireRole(userId: string, allowed: readonly PlanRole[]): PlanRole {
    if (!this.exists()) throw new AccessError("That plan doesn't exist.");
    const role = this.role(userId);
    if (!role || !allowed.includes(role)) throw new AccessError(role ? "You can't do that with this plan." : "That plan isn't shared with you.");
    return role;
  }
}
