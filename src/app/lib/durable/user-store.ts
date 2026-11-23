import { consumeTokens, type BucketLimit, type RequestBudget } from "@/app/lib/api/rate-limit-store";
import { LIMIT_MESSAGES, USER_LIMITS } from "./limits";
import { AccessError, LimitError, migrate, type Migration, type Sql } from "./sql";

/**
 * One user's data, keyed by their WorkOS user id: profile, saved builds and item groups, the index
 * of raid plans they own or that are shared with them, plan-creation history, and their MCP budget.
 * It runs inside the user's Durable Object (UserDO), which serves one request at a time, so every
 * limit here is exact.
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
      `CREATE TABLE builds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE item_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
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
      `CREATE TABLE budgets (
        key TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ],
  },
];

export type PlanRole = "owner" | "editor" | "viewer";

export interface PlanIndexEntry {
  planId: string;
  role: PlanRole;
  title: string;
  map: string;
  updatedAt: number;
  addedAt: number;
}

export interface SavedEntry {
  id: string;
  name: string;
  data: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface Profile {
  userId: string;
  email: string | null;
  name: string | null;
  createdAt: number;
  updatedAt: number;
}

const HOUR_MS = 60 * 60_000;
type EntryTable = "builds" | "item_groups";

export class UserStore {
  constructor(
    private readonly sql: Sql,
    private readonly transaction: (work: () => void) => void,
    private readonly now: () => number = Date.now
  ) {}

  migrate() {
    return migrate(this.sql, USER_MIGRATIONS, this.transaction);
  }

  // Profile

  profile(): Profile | null {
    const row = this.sql
      .exec<{ user_id: string; email: string | null; name: string | null; created_at: number; updated_at: number }>(
        "SELECT user_id, email, name, created_at, updated_at FROM profile WHERE id = 1"
      )
      .toArray()[0];
    return row ? { userId: row.user_id, email: row.email, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }

  saveProfile(userId: string, details: { email?: string | null; name?: string | null }) {
    const now = this.now();
    this.sql.exec(
      `INSERT INTO profile (id, user_id, email, name, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, updated_at = excluded.updated_at`,
      userId,
      details.email ?? null,
      details.name ?? null,
      now,
      now
    );
    return this.profile()!;
  }

  // Builds and item groups

  listEntries(table: EntryTable): SavedEntry[] {
    return this.sql
      .exec<{ id: string; name: string; data: string; created_at: number; updated_at: number }>(
        `SELECT id, name, data, created_at, updated_at FROM ${table} ORDER BY updated_at DESC`
      )
      .toArray()
      .map((row) => ({ id: row.id, name: row.name, data: JSON.parse(row.data) as unknown, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  /** Saves a new entry or replaces one; a new entry past the limit is refused. */
  saveEntry(table: EntryTable, entry: { id: string; name: string; data: unknown }) {
    const data = JSON.stringify(entry.data);
    if (new TextEncoder().encode(data).byteLength > USER_LIMITS.entryBytes) throw new LimitError("entry_size", LIMIT_MESSAGES.entrySize);
    const exists = this.sql.exec(`SELECT 1 FROM ${table} WHERE id = ?`, entry.id).toArray().length > 0;
    if (!exists) {
      const [limit, code, message] =
        table === "builds"
          ? ([USER_LIMITS.builds, "builds", LIMIT_MESSAGES.builds] as const)
          : ([USER_LIMITS.itemGroups, "item_groups", LIMIT_MESSAGES.itemGroups] as const);
      if (this.count(table) >= limit) throw new LimitError(code, message);
    }
    const now = this.now();
    this.sql.exec(
      `INSERT INTO ${table} (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
      entry.id,
      entry.name,
      data,
      now,
      now
    );
  }

  deleteEntry(table: EntryTable, id: string) {
    this.sql.exec(`DELETE FROM ${table} WHERE id = ?`, id);
  }

  // Raid plan index

  plans(): PlanIndexEntry[] {
    return this.sql
      .exec<{ plan_id: string; role: PlanRole; title: string; map: string; updated_at: number; added_at: number }>(
        "SELECT plan_id, role, title, map, updated_at, added_at FROM plans ORDER BY updated_at DESC"
      )
      .toArray()
      .map((row) => ({ planId: row.plan_id, role: row.role, title: row.title, map: row.map, updatedAt: row.updated_at, addedAt: row.added_at }));
  }

  /**
   * Checks that the user may create a plan now, and records the creation: under the owned-plan
   * limit (counting plans handed to them, which may have taken them past it) and the hourly rate.
   */
  reservePlanCreation() {
    const now = this.now();
    if (this.countPlans("owner") >= USER_LIMITS.ownedPlans) throw new LimitError("owned_plans", LIMIT_MESSAGES.ownedPlans);
    this.sql.exec("DELETE FROM plan_creations WHERE created_at <= ?", now - HOUR_MS);
    const recent = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM plan_creations").one().n;
    if (recent >= USER_LIMITS.plansCreatedPerHour) throw new LimitError("plan_rate", LIMIT_MESSAGES.planRate);
    this.sql.exec("INSERT INTO plan_creations (created_at) VALUES (?)", now);
  }

  /**
   * Adds a plan to the index, or changes the user's role in it. `source` says why: a plan the user
   * created (reserved beforehand), shared with them (limited), or handed to them (always allowed).
   */
  recordPlan(entry: { planId: string; role: PlanRole; title: string; map: string; updatedAt: number }, source: "created" | "shared" | "transferred") {
    const existing = this.sql.exec<{ role: PlanRole }>("SELECT role FROM plans WHERE plan_id = ?", entry.planId).toArray()[0];
    if (source === "shared" && entry.role !== "owner" && (!existing || existing.role === "owner")) {
      if (this.countPlans("shared") >= USER_LIMITS.sharedPlans) throw new LimitError("shared_plans", LIMIT_MESSAGES.sharedPlans);
    }
    if (source === "shared" && entry.role === "owner") throw new AccessError("Sharing can't make someone a plan's owner.");
    this.sql.exec(
      `INSERT INTO plans (plan_id, role, title, map, updated_at, added_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(plan_id) DO UPDATE SET role = excluded.role, title = excluded.title, map = excluded.map, updated_at = excluded.updated_at`,
      entry.planId,
      entry.role,
      entry.title,
      entry.map,
      entry.updatedAt,
      this.now()
    );
  }

  /** Updates the title, map and edit time the index shows for a plan, if the user has it. */
  touchPlan(planId: string, details: { title: string; map: string; updatedAt: number }) {
    this.sql.exec("UPDATE plans SET title = ?, map = ?, updated_at = ? WHERE plan_id = ?", details.title, details.map, details.updatedAt, planId);
  }

  forgetPlan(planId: string) {
    this.sql.exec("DELETE FROM plans WHERE plan_id = ?", planId);
  }

  // MCP budget

  /** Charges the user's token bucket; see src/app/lib/mcp/budget.ts for costs and refunds. */
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

  // Counts

  usage() {
    return {
      ownedPlans: this.countPlans("owner"),
      sharedPlans: this.countPlans("shared"),
      builds: this.count("builds"),
      itemGroups: this.count("item_groups"),
    };
  }

  private count(table: EntryTable) {
    return this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
  }

  private countPlans(kind: "owner" | "shared") {
    const query = kind === "owner" ? "SELECT COUNT(*) AS n FROM plans WHERE role = 'owner'" : "SELECT COUNT(*) AS n FROM plans WHERE role != 'owner'";
    return this.sql.exec<{ n: number }>(query).one().n;
  }
}
