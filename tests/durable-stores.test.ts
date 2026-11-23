// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { LIMIT_MESSAGES, PLAN_LIMITS, USER_LIMITS } from "@/app/lib/durable/limits";
import { PlanStore } from "@/app/lib/durable/plan-store";
import { AccessError, LimitError, type Sql, type SqlValue } from "@/app/lib/durable/sql";
import { UserStore } from "@/app/lib/durable/user-store";
import { createPlan, sharePlan, transferPlan, unsharePlan, deletePlan, type DurableBindings } from "@/app/lib/durable/access";
import { outcome } from "@/app/lib/durable/outcome";
import type { RaidPlan } from "@/app/lib/raid-planner/types";

/** A Durable Object's SQL API over Node's SQLite, as the stores use it. */
function sqlite() {
  const db = new DatabaseSync(":memory:");
  const sql: Sql = {
    exec(query: string, ...bindings: SqlValue[]) {
      const statement = db.prepare(query);
      const rows = (statement.columns().length ? statement.all(...(bindings as never[])) : (statement.run(...(bindings as never[])), [])) as never[];
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}.`);
          return rows[0];
        },
      };
    },
  };
  const transaction = (work: () => void) => {
    db.exec("BEGIN");
    try {
      work();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  return { sql, transaction };
}

let now = 1_800_000_000_000;
const clock = () => now;

function userStore() {
  const { sql, transaction } = sqlite();
  const store = new UserStore(sql, transaction, clock);
  store.migrate();
  return store;
}

function planStore() {
  const { sql, transaction } = sqlite();
  const store = new PlanStore(sql, transaction, clock);
  store.migrate();
  return store;
}

function plan(overrides: Partial<RaidPlan> = {}): RaidPlan {
  return {
    id: "p1",
    name: "Dorms run",
    mapKey: "customs",
    createdAt: now,
    updatedAt: now,
    enabledLayers: [],
    route: [],
    drawings: [],
    notes: [],
    ...overrides,
  };
}

beforeEach(() => {
  now = 1_800_000_000_000;
});

describe("UserStore", () => {
  it("migrates once and keeps the schema version", () => {
    const { sql, transaction } = sqlite();
    const store = new UserStore(sql, transaction, clock);
    expect(store.migrate()).toBe(1);
    expect(store.migrate()).toBe(1);
    const tables = sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").toArray().map((row) => row.name);
    expect(tables).toEqual(["budgets", "builds", "item_groups", "plan_creations", "plans", "profile", "schema_meta"]);
  });

  it("saves the profile and updates it in place", () => {
    const store = userStore();
    expect(store.profile()).toBeNull();
    store.saveProfile("user_1", { email: "a@example.com", name: "A" });
    now += 1_000;
    const saved = store.saveProfile("user_1", { email: "b@example.com", name: null });
    expect(saved).toEqual({ userId: "user_1", email: "b@example.com", name: null, createdAt: 1_800_000_000_000, updatedAt: 1_800_000_001_000 });
  });

  it("limits builds and item groups exactly, replacing an existing entry at the limit", () => {
    const store = userStore();
    for (let i = 0; i < USER_LIMITS.itemGroups; i += 1) store.saveEntry("item_groups", { id: `g${i}`, name: `Group ${i}`, data: { items: [] } });
    expect(() => store.saveEntry("item_groups", { id: "one-more", name: "x", data: {} })).toThrow(LimitError);
    expect(() => store.saveEntry("item_groups", { id: "one-more", name: "x", data: {} })).toThrow(LIMIT_MESSAGES.itemGroups);
    store.saveEntry("item_groups", { id: "g0", name: "Renamed", data: { items: ["Salewa"] } });
    expect(store.usage().itemGroups).toBe(USER_LIMITS.itemGroups);
    expect(store.listEntries("item_groups").find((entry) => entry.id === "g0")).toMatchObject({ name: "Renamed", data: { items: ["Salewa"] } });
    store.deleteEntry("item_groups", "g1");
    store.saveEntry("item_groups", { id: "one-more", name: "x", data: {} });
    expect(store.usage().itemGroups).toBe(USER_LIMITS.itemGroups);

    for (let i = 0; i < USER_LIMITS.builds; i += 1) store.saveEntry("builds", { id: `b${i}`, name: `Build ${i}`, data: {} });
    expect(() => store.saveEntry("builds", { id: "b-extra", name: "x", data: {} })).toThrow(LIMIT_MESSAGES.builds);
  });

  it("refuses an entry larger than the entry size limit", () => {
    const store = userStore();
    expect(() => store.saveEntry("builds", { id: "big", name: "Big", data: "x".repeat(USER_LIMITS.entryBytes) })).toThrow(LIMIT_MESSAGES.entrySize);
  });

  it("limits plan creation to the hourly rate, counting only the last hour", () => {
    const store = userStore();
    for (let i = 0; i < USER_LIMITS.plansCreatedPerHour; i += 1) store.reservePlanCreation();
    expect(() => store.reservePlanCreation()).toThrow(LIMIT_MESSAGES.planRate);
    now += 60 * 60_000 + 1;
    expect(() => store.reservePlanCreation()).not.toThrow();
  });

  it("limits owned and shared plans, allows a handover past the limit, and blocks creating until back under", () => {
    const store = userStore();
    const entry = (planId: string, role: "owner" | "editor" | "viewer") => ({ planId, role, title: planId, map: "customs", updatedAt: now });
    for (let i = 0; i < USER_LIMITS.ownedPlans; i += 1) store.recordPlan(entry(`own-${i}`, "owner"), "created");
    expect(() => store.reservePlanCreation()).toThrow(LIMIT_MESSAGES.ownedPlans);
    // Handed over: allowed even past the limit.
    store.recordPlan(entry("handed", "owner"), "transferred");
    expect(store.usage().ownedPlans).toBe(USER_LIMITS.ownedPlans + 1);
    expect(() => store.reservePlanCreation()).toThrow(LIMIT_MESSAGES.ownedPlans);
    store.forgetPlan("handed");
    store.forgetPlan("own-0");
    expect(() => store.reservePlanCreation()).not.toThrow();

    for (let i = 0; i < USER_LIMITS.sharedPlans; i += 1) store.recordPlan(entry(`shared-${i}`, i % 2 ? "viewer" : "editor"), "shared");
    expect(() => store.recordPlan(entry("shared-extra", "viewer"), "shared")).toThrow(LIMIT_MESSAGES.sharedPlans);
    // Changing the role on a plan already shared isn't a new share.
    expect(() => store.recordPlan(entry("shared-1", "editor"), "shared")).not.toThrow();
    expect(() => store.recordPlan(entry("shared-x", "owner"), "shared")).toThrow(AccessError);
  });

  it("charges the MCP budget as the in-memory bucket did, refunding on denial", () => {
    const store = userStore();
    const limit = { burst: 2, refillPerSecond: 1 };
    expect(store.chargeBudget("mcp", limit, 0.25, 0)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(store.chargeBudget("mcp", limit, 1.75, 0.25)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(store.chargeBudget("mcp", limit, 0.25, 0)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    now += 2_000;
    expect(store.chargeBudget("mcp", limit, 2, 0).allowed).toBe(true);
  });
});

describe("PlanStore", () => {
  it("creates a plan with its owner and checks content against the planner's limits", () => {
    const store = planStore();
    expect(() => store.create("p1", "owner", { not: "a plan" })).toThrow(LimitError);
    const created = store.create("p1", "owner", plan());
    expect(created).toMatchObject({ planId: "p1", version: 1, role: "owner", plan: { name: "Dorms run" } });
    expect(() => store.create("p1", "owner", plan())).toThrow(AccessError);
  });

  it("refuses a plan past the size limit", () => {
    const store = planStore();
    const note = { id: "n", position: { x: 0, z: 0 }, title: "t", body: "x".repeat(PLAN_LIMITS.maxNoteBodyLength), color: "#ffffff" };
    const notes = Array.from({ length: 200 }, (_, index) => ({ ...note, id: `n${index}` }));
    expect(() => store.create("big", "owner", plan({ notes }))).toThrow(LIMIT_MESSAGES.planSize);
  });

  it("lets editors edit, viewers only read, and refuses an edit made against an older version", () => {
    const store = planStore();
    store.create("p1", "owner", plan());
    store.share("owner", "editor", "editor");
    store.share("owner", "viewer", "viewer");
    expect(store.read("viewer").role).toBe("viewer");
    expect(() => store.update("viewer", plan({ name: "No" }))).toThrow(AccessError);
    expect(store.update("editor", plan({ name: "Edited" }), 1)).toMatchObject({ version: 2, plan: { name: "Edited" } });
    expect(() => store.update("owner", plan({ name: "Late" }), 1)).toThrow("The plan changed since you opened it");
    expect(() => store.read("stranger")).toThrow("That plan isn't shared with you.");
  });

  it("hands the plan over, keeping the previous owner as an editor", () => {
    const store = planStore();
    store.create("p1", "owner", plan());
    expect(() => store.transfer("owner", "stranger")).toThrow("Share the plan with them before handing it over.");
    store.share("owner", "next", "viewer");
    store.transfer("owner", "next");
    expect(store.role("next")).toBe("owner");
    expect(store.role("owner")).toBe("editor");
    expect(() => store.unshare("next", "next")).toThrow("Hand the plan to someone else before leaving it.");
    store.unshare("owner", "owner");
    expect(store.role("owner")).toBeNull();
  });

  it("deletes everything and says who had it", () => {
    const store = planStore();
    store.create("p1", "owner", plan());
    store.share("owner", "a", "viewer");
    expect(() => store.delete("a")).toThrow(AccessError);
    expect(store.delete("owner").sort()).toEqual(["a", "owner"]);
    expect(store.exists()).toBe(false);
  });
});

/** Durable Object namespaces backed by the stores above, calling them as RPC would (through outcome). */
function bindings() {
  const users = new Map<string, UserStore>();
  const plans = new Map<string, PlanStore>();
  const user = (id: string) => {
    if (!users.has(id)) users.set(id, userStore());
    const store = users.get(id)!;
    return {
      reservePlanCreation: async () => outcome(() => (store.reservePlanCreation(), null)),
      recordPlan: async (...args: Parameters<UserStore["recordPlan"]>) => outcome(() => (store.recordPlan(...args), null)),
      touchPlan: async (...args: Parameters<UserStore["touchPlan"]>) => store.touchPlan(...args),
      forgetPlan: async (planId: string) => store.forgetPlan(planId),
    };
  };
  const planObject = (id: string) => {
    if (!plans.has(id)) plans.set(id, planStore());
    const store = plans.get(id)!;
    return {
      create: async (...args: Parameters<PlanStore["create"]>) => outcome(() => store.create(...args)),
      read: async (userId: string) => outcome(() => store.read(userId)),
      update: async (...args: Parameters<PlanStore["update"]>) => outcome(() => store.update(...args)),
      members: async (userId: string) => outcome(() => store.members(userId)),
      share: async (...args: Parameters<PlanStore["share"]>) => outcome(() => (store.share(...args), null)),
      unshare: async (...args: Parameters<PlanStore["unshare"]>) => outcome(() => (store.unshare(...args), null)),
      transfer: async (...args: Parameters<PlanStore["transfer"]>) => outcome(() => (store.transfer(...args), null)),
      delete: async (ownerId: string) => outcome(() => store.delete(ownerId)),
    };
  };
  const env = {
    USER: { idFromName: (name: string) => name, get: (id: string) => user(id) },
    PLAN: { idFromName: (name: string) => name, get: (id: string) => planObject(id) },
  } as unknown as DurableBindings;
  return { env, users };
}

describe("access helpers", () => {
  it("keep each member's index in step with the plan", async () => {
    const { env, users } = bindings();
    const stored = await createPlan(env, "alice", plan());
    expect(users.get("alice")!.plans()).toEqual([expect.objectContaining({ planId: stored.planId, role: "owner", title: "Dorms run" })]);

    await sharePlan(env, "alice", stored.planId, "bob", "editor");
    expect(users.get("bob")!.plans()).toEqual([expect.objectContaining({ planId: stored.planId, role: "editor" })]);

    await transferPlan(env, "alice", stored.planId, "bob");
    expect(users.get("bob")!.plans()[0].role).toBe("owner");
    expect(users.get("alice")!.plans()[0].role).toBe("editor");

    await unsharePlan(env, "bob", stored.planId, "alice");
    expect(users.get("alice")!.plans()).toEqual([]);

    await deletePlan(env, "bob", stored.planId);
    expect(users.get("bob")!.plans()).toEqual([]);
  });

  it("check a share against the other user's limit before changing the plan", async () => {
    const { env, users } = bindings();
    const stored = await createPlan(env, "alice", plan());
    const bob = userStore();
    users.set("bob", bob);
    for (let i = 0; i < USER_LIMITS.sharedPlans; i += 1) {
      bob.recordPlan({ planId: `other-${i}`, role: "viewer", title: "x", map: "customs", updatedAt: now }, "shared");
    }
    await expect(sharePlan(env, "alice", stored.planId, "bob", "viewer")).rejects.toThrow(LIMIT_MESSAGES.sharedPlans);
    await expect(sharePlan(env, "alice", stored.planId, "carol", "viewer")).resolves.toBeUndefined();
  });

  it("refuse a plan over the limits before reserving a creation", async () => {
    const { env, users } = bindings();
    await expect(createPlan(env, "alice", { ...plan(), route: "nope" } as unknown as RaidPlan)).rejects.toThrow(LimitError);
    expect(users.get("alice")?.usage().ownedPlans ?? 0).toBe(0);
  });
});
