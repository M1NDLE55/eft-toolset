// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { UserStore, USER_MIGRATIONS } from "@/app/lib/durable/user-store";
import { migrate } from "@/app/lib/durable/sql";
import { RETENTION_MS, USER_LIMITS } from "@/app/lib/durable/limits";
import { newRecordId } from "@/app/lib/sharing/ids";
import type { BuildValue, Mutation, MutationResult } from "@/app/lib/sharing/types";
import { sqlite, testClock } from "./helpers/sqlite";

const clock = testClock();

function store() {
  const { sql, transaction } = sqlite();
  const user = new UserStore(sql, transaction, clock.now);
  user.migrate();
  user.ensureProfile("user_1", () => 0.5);
  return user;
}

const weapon = "5447a9cd4bdc2dbd208b4567";

function build(overrides: Partial<BuildValue> = {}): BuildValue {
  return {
    name: "M4 meta",
    weaponId: weapon,
    root: {
      itemId: weapon,
      slots: {
        mod_pistol_grip: { itemId: "grip1", slots: {} },
        mod_reciever: { itemId: "upper1", slots: { mod_barrel: { itemId: "barrel1", slots: { mod_muzzle: { itemId: "muzzle1", slots: {} } } } } },
      },
    },
    ...overrides,
  };
}

let counter = 0;
const mid = () => `mutation-${(counter += 1)}`;

function applied(result: MutationResult) {
  if (result.status !== "applied") throw new Error(`Expected applied, got ${JSON.stringify(result)}`);
  return result;
}

function createBuild(user: UserStore, value = build()) {
  // A second apart, so long setups stay inside the library-writes rate.
  clock.advance(1_000);
  const id = newRecordId();
  const [result] = user.applyMutations([{ mutationId: mid(), kind: "build", op: "create", id, value }]);
  return { id, result: applied(result) };
}

function createGroup(user: UserStore, name = "Keys", items: string[] = ["Dorm 314"]) {
  clock.advance(1_000);
  const id = newRecordId();
  const [result] = user.applyMutations([{ mutationId: mid(), kind: "item_group", op: "create", id, value: { name, items } }]);
  return { id, result: applied(result) };
}

beforeEach(() => {
  clock.set(1_800_000_000_000);
});

describe("UserStore schema", () => {
  it("migrates from version 1, keeping the MCP budget rows", () => {
    const { sql, transaction } = sqlite();
    migrate(sql, USER_MIGRATIONS.slice(0, 1), transaction);
    sql.exec("INSERT INTO budgets (key, tokens, updated_at) VALUES ('mcp', 12, 1)");
    const user = new UserStore(sql, transaction, clock.now);
    expect(user.migrate()).toBe(2);
    expect(sql.exec<{ tokens: number }>("SELECT tokens FROM budgets WHERE key = 'mcp'").one().tokens).toBe(12);
    expect(user.migrate()).toBe(2);
  });

  it("generates a display name instead of using the real name, and validates changes", () => {
    const user = store();
    expect(user.displayName()).toBe("Scav-5500");
    expect(() => user.setDisplayName("x")).toThrow(/2 to 32/);
    expect(() => user.setDisplayName("<script>")).toThrow(/2 to 32/);
    expect(user.setDisplayName("  Knight  ")).toBe("Knight");
  });
});

describe("library mutations", () => {
  it("creates builds up to exactly 200 and refuses the next with the limit and usage", () => {
    const user = store();
    for (let index = 0; index < USER_LIMITS.builds; index += 1) createBuild(user, build({ name: `Build ${index}` }));
    const [result] = user.applyMutations([{ mutationId: mid(), kind: "build", op: "create", id: newRecordId(), value: build() }]);
    expect(result).toMatchObject({ status: "rejected", code: "limit", details: { limit: 200, used: 200 } });
    expect(user.usage().builds).toBe(200);
  });

  it("limits item groups to 50, with names unique case-insensitively", () => {
    const user = store();
    createGroup(user, "Keys");
    const [clash] = user.applyMutations([{ mutationId: mid(), kind: "item_group", op: "create", id: newRecordId(), value: { name: "KEYS", items: [] } }]);
    expect(clash).toMatchObject({ status: "rejected", code: "invalid" });
    for (let index = 1; index < USER_LIMITS.itemGroups; index += 1) createGroup(user, `Group ${index}`);
    const [over] = user.applyMutations([{ mutationId: mid(), kind: "item_group", op: "create", id: newRecordId(), value: { name: "One more", items: [] } }]);
    expect(over).toMatchObject({ status: "rejected", code: "limit" });
  });

  it("rejects malformed ids, taken ids and invalid builds", () => {
    const user = store();
    const { id } = createBuild(user);
    const results = user.applyMutations([
      { mutationId: mid(), kind: "build", op: "create", id: "short", value: build() },
      { mutationId: mid(), kind: "build", op: "create", id, value: build() },
      { mutationId: mid(), kind: "build", op: "create", id: newRecordId(), value: { ...build(), weaponId: "other" } },
    ]);
    expect(results.map((result) => result.status === "rejected" && result.code)).toEqual(["invalid", "invalid", "invalid"]);
  });

  it("returns the stored result for a replayed mutation id instead of applying it twice", () => {
    const user = store();
    const { id } = createBuild(user);
    const mutation: Mutation = { mutationId: "replay-1", kind: "build", op: "patch", id, baseVersion: 1, patch: { name: "Renamed" } };
    const first = applied(user.applyMutations([mutation])[0]);
    const second = applied(user.applyMutations([mutation])[0]);
    expect(second).toEqual(first);
    expect(user.record("build", id)!.version).toBe(2);
  });

  it("applies a patch at the current version, and merges a stale patch that touches other fields", () => {
    const user = store();
    const { id } = createBuild(user);
    applied(user.applyMutations([{ mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 1, patch: { name: "Phone rename" } }])[0]);
    // Another device, still at version 1, changes the grip: a different slot, so it merges.
    const merged = applied(
      user.applyMutations([{ mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 1, patch: { slots: { mod_pistol_grip: "grip2" } } }])[0]
    );
    expect(merged.merged).toBe(true);
    expect(merged.record).toMatchObject({ name: "Phone rename", version: 3 });
    expect((merged.record as BuildValue).root.slots.mod_pistol_grip.itemId).toBe("grip2");
  });

  it("reports a conflict when the same slot, a slot above it, or a slot below it changed", () => {
    const user = store();
    const { id } = createBuild(user);
    applied(
      user.applyMutations([{ mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 1, patch: { slots: { "mod_reciever/mod_barrel/mod_muzzle": "muzzle2" } } }])[0]
    );
    const receiver = user.applyMutations([{ mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 1, patch: { slots: { mod_reciever: "upper2" } } }])[0];
    expect(receiver).toMatchObject({ status: "conflict", fields: ["slot:mod_reciever"], theirs: { version: 2 } });
    const same = user.applyMutations([
      { mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 1, patch: { slots: { "mod_reciever/mod_barrel/mod_muzzle": "muzzle3" } } },
    ])[0];
    expect(same.status).toBe("conflict");
    // Nothing in a conflicting mutation applies, and it isn't remembered: re-sent with the new base, it applies.
    expect(user.record("build", id)!.version).toBe(2);
    const keepMine = user.applyMutations([{ mutationId: (same as { mutationId: string }).mutationId, kind: "build", op: "patch", id, baseVersion: 2, patch: { slots: { mod_reciever: "upper2" } } }])[0];
    expect(applied(keepMine).version).toBe(3);
  });

  it("merges item-group edits per item and never asks about items; a rename clash takes a free name", () => {
    const user = store();
    const { id } = createGroup(user, "Keys", ["A", "B"]);
    createGroup(user, "Loot", []);
    applied(user.applyMutations([{ mutationId: mid(), kind: "item_group", op: "patch", id, baseVersion: 1, patch: { add: ["C"] } }])[0]);
    const stale = applied(user.applyMutations([{ mutationId: mid(), kind: "item_group", op: "patch", id, baseVersion: 1, patch: { remove: ["A"], add: ["D"] } }])[0]);
    expect(stale.record).toMatchObject({ items: ["B", "C", "D"], version: 3 });
    const renamed = applied(user.applyMutations([{ mutationId: mid(), kind: "item_group", op: "patch", id, baseVersion: 3, patch: { name: "loot" } }])[0]);
    expect(renamed.record).toMatchObject({ name: "loot (2)" });
    applied(user.applyMutations([{ mutationId: mid(), kind: "item_group", op: "patch", id, baseVersion: 4, patch: { name: "Keys" } }])[0]);
    const clash = user.applyMutations([{ mutationId: mid(), kind: "item_group", op: "patch", id, baseVersion: 3, patch: { name: "Other" } }])[0];
    expect(clash).toMatchObject({ status: "conflict", fields: ["name"] });
  });

  it("refuses a delete made against an older version, so it never destroys unseen edits", () => {
    const user = store();
    const { id } = createBuild(user);
    applied(user.applyMutations([{ mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 1, patch: { name: "Edited" } }])[0]);
    expect(user.applyMutations([{ mutationId: mid(), kind: "build", op: "delete", id, baseVersion: 1 }])[0]).toMatchObject({ status: "conflict", fields: ["*"] });
    applied(user.applyMutations([{ mutationId: mid(), kind: "build", op: "delete", id, baseVersion: 2 }])[0]);
    expect(user.usage().builds).toBe(0);
  });

  it("restores a deleted record when an edit arrives after the delete, past the limit, with its links still revoked", () => {
    const user = store();
    const { id } = createBuild(user);
    const link = user.createLink("1aaaaaaaaaaaaaaaaaaaa", { type: "build", id }, "copy", null);
    applied(user.applyMutations([{ mutationId: mid(), kind: "build", op: "delete", id, baseVersion: 1 }])[0]);
    for (let index = 0; index < USER_LIMITS.builds; index += 1) createBuild(user, build({ name: `Fill ${index}` }));
    const restored = applied(user.applyMutations([{ mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 1, patch: { name: "Offline edit" } }])[0]);
    expect(restored.restored).toBe(true);
    expect(user.usage().builds).toBe(201);
    expect(user.link(link.code)!.status).toBe("revoked");
    expect(user.notices()[0].body).toMatch(/restored/);
  });

  it("charges the library-writes bucket: 120 at once, then 2 a second", () => {
    const user = store();
    const { id } = createBuild(user);
    const mutations = Array.from({ length: 50 }, (_, index): Mutation => ({ mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 1 + index, patch: { name: `n${index}` } }));
    user.applyMutations(mutations);
    user.applyMutations(mutations.map((mutation) => ({ ...mutation, mutationId: mid(), baseVersion: 999 })));
    const results = user.applyMutations(Array.from({ length: 30 }, (_, index): Mutation => ({ mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 51 + index, patch: { name: `m${index}` } })));
    expect(results.filter((result) => result.status === "rejected" && result.code === "rate_limited")).toHaveLength(11);
    clock.advance(5_000);
    expect(user.applyMutations([{ mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 70, patch: { name: "later" } }])[0].status).toBe("applied");
  });
});

describe("change log", () => {
  it("lists records and tombstones changed after a cursor, one row per record", () => {
    const user = store();
    const a = createBuild(user).id;
    const b = createBuild(user, build({ name: "B" })).id;
    const cursor = user.seq();
    for (let version = 1; version <= 5; version += 1) {
      applied(user.applyMutations([{ mutationId: mid(), kind: "build", op: "patch", id: a, baseVersion: version, patch: { name: `v${version}` } }])[0]);
    }
    applied(user.applyMutations([{ mutationId: mid(), kind: "build", op: "delete", id: b, baseVersion: 1 }])[0]);
    const changes = user.changesSince(cursor);
    if (changes.resync) throw new Error("unexpected resync");
    expect(changes.records.map((record) => [record.id, record.version])).toEqual([[a, 6]]);
    expect(changes.tombstones).toEqual([{ kind: "build", id: b, version: 2 }]);
  });

  it("purges tombstones after 30 days and asks a device with an older cursor to resync", () => {
    const user = store();
    const { id } = createBuild(user);
    const oldCursor = user.seq();
    applied(user.applyMutations([{ mutationId: mid(), kind: "build", op: "delete", id, baseVersion: 1 }])[0]);
    const recentCursor = user.seq();
    clock.advance(RETENTION_MS + 1);
    user.sweep();
    expect(user.record("build", id)).toBeNull();
    expect(user.changesSince(oldCursor)).toEqual({ resync: true });
    expect(user.changesSince(recentCursor)).toMatchObject({ records: [], tombstones: [] });
    // A queued patch for the purged record is told it is gone, so the device re-creates it.
    expect(user.applyMutations([{ mutationId: mid(), kind: "build", op: "patch", id, baseVersion: 1, patch: { name: "x" } }])[0]).toMatchObject({ status: "rejected", code: "gone" });
  });
});

describe("settings", () => {
  it("keeps the newest change for a preference, even when an older one arrives later", () => {
    const user = store();
    const first = applied(user.applyMutations([{ mutationId: mid(), kind: "setting", op: "patch", id: "settings:home-layout", baseVersion: 0, patch: { value: "a", changedAt: 100 } }])[0]);
    applied(user.applyMutations([{ mutationId: mid(), kind: "setting", op: "patch", id: "settings:home-layout", baseVersion: first.version, patch: { value: "b", changedAt: 300 } }])[0]);
    const late = applied(user.applyMutations([{ mutationId: mid(), kind: "setting", op: "patch", id: "settings:home-layout", baseVersion: first.version, patch: { value: "old", changedAt: 200 } }])[0]);
    expect(late.record).toMatchObject({ value: "b", version: 2 });
    const newer = applied(user.applyMutations([{ mutationId: mid(), kind: "setting", op: "patch", id: "settings:home-layout", baseVersion: first.version, patch: { value: "c", changedAt: 400 } }])[0]);
    expect(newer.record).toMatchObject({ value: "c", version: 3 });
  });

  it("asks Keep mine or Keep theirs when two devices disagree about the same quest", () => {
    const user = store();
    const key = "quest-progress:5936d90786f7742b1420ba5b";
    applied(user.applyMutations([{ mutationId: mid(), kind: "setting", op: "patch", id: key, baseVersion: 0, patch: { value: { done: true }, changedAt: 1 } }])[0]);
    applied(user.applyMutations([{ mutationId: mid(), kind: "setting", op: "patch", id: key, baseVersion: 1, patch: { value: { done: false }, changedAt: 2 } }])[0]);
    const clash = user.applyMutations([{ mutationId: mid(), kind: "setting", op: "patch", id: key, baseVersion: 1, patch: { value: { done: true, objectives: 2 }, changedAt: 9 } }])[0];
    expect(clash).toMatchObject({ status: "conflict", fields: [key], theirs: { version: 2 } });
    // The same value from both devices is no clash.
    expect(user.applyMutations([{ mutationId: mid(), kind: "setting", op: "patch", id: key, baseVersion: 1, patch: { value: { done: false }, changedAt: 9 } }])[0].status).toBe("applied");
  });

  it("refuses keys that don't sync", () => {
    const user = store();
    expect(user.applyMutations([{ mutationId: mid(), kind: "setting", op: "patch", id: "secret", baseVersion: 0, patch: { value: 1, changedAt: 1 } }])[0]).toMatchObject({
      status: "rejected",
      code: "invalid",
    });
  });
});

describe("imports and copies", () => {
  it("skips exact duplicates by content hash and renames a group whose name is taken by different contents", () => {
    const user = store();
    const first = user.importItem({ type: "build", id: newRecordId(), value: build() }, "migration");
    expect(first.status).toBe("created");
    expect(user.importItem({ type: "build", id: newRecordId(), value: build() }, "migration")).toEqual({ status: "duplicate", id: (first as { record: { id: string } }).record.id });
    createGroup(user, "Keys", ["A"]);
    expect(user.importItem({ type: "item_group", id: newRecordId(), value: { name: "keys", items: ["A"] } }, "migration").status).toBe("duplicate");
    const renamed = user.importItem({ type: "item_group", id: newRecordId(), value: { name: "Keys", items: ["B"] } }, "migration");
    expect(renamed).toMatchObject({ status: "created", record: { name: "Keys (from browser)" } });
  });

  it("caps imports at 300 a day", () => {
    const user = store();
    for (let index = 0; index < 300; index += 1) {
      user.chargeBudget("rate:imports", { burst: 300, refillPerSecond: 300 / 86_400 }, 1, 0);
    }
    expect(() => user.importItem({ type: "build", id: newRecordId(), value: build() }, "restore")).toThrow(/Too many/);
  });
});

describe("links to builds and item groups", () => {
  it("allows 5 active links per item, and checks revoked, expired, paused and copy-off on open", () => {
    const user = store();
    const { id } = createBuild(user);
    const codes = Array.from({ length: 5 }, (_, index) => `1${String(index).repeat(20)}`);
    codes.forEach((code, index) => user.createLink(code, { type: "build", id }, index === 0 ? "copy" : "view", index === 1 ? 1 : null));
    expect(() => user.createLink("1zzzzzzzzzzzzzzzzzzzz", { type: "build", id }, "view", null)).toThrow(/at most 5/);
    expect(user.openLink(codes[0]).access).toBe("copy");
    expect(user.exportForLink(codes[0]).snapshot).toMatchObject({ name: "M4 meta" });
    user.setAllowCopy("build", id, false);
    expect(user.openLink(codes[0]).access).toBe("view");
    expect(() => user.exportForLink(codes[0])).toThrow(/doesn't allow copies/);
    user.revokeLink(codes[2]);
    expect(() => user.openLink(codes[2])).toThrow(/revoked/);
    clock.advance(24 * 60 * 60_000 + 1);
    expect(() => user.openLink(codes[1])).toThrow(/expired/);
    user.setLinkPaused(codes[3], true);
    expect(() => user.openLink(codes[3])).toThrow(/under review/);
    expect(user.openLink(codes[3], { count: false, asOwner: true }).access).toBe("view");
    expect(user.link(codes[0])).toMatchObject({ opens: 2, copies: 1 });
  });

  it("revokes an item's links when it is deleted", () => {
    const user = store();
    const { id } = createGroup(user);
    user.createLink("1bbbbbbbbbbbbbbbbbbbb", { type: "item_group", id }, "view", null);
    applied(user.applyMutations([{ mutationId: mid(), kind: "item_group", op: "delete", id, baseVersion: 1 }])[0]);
    expect(() => user.openLink("1bbbbbbbbbbbbbbbbbbbb")).toThrow(/revoked/);
  });
});

describe("plan index and plan limits", () => {
  it("counts owned plans exactly, including pending reservations, and limits creation to 20 an hour", () => {
    const user = store();
    for (let index = 0; index < 20; index += 1) {
      const id = newRecordId();
      user.reservePlan(id, { kind: "create" });
      user.confirmPlan(id, { name: `P${index}`, mapKey: "customs", rev: 0, updatedAt: clock.now() });
    }
    expect(() => user.reservePlan(newRecordId(), { kind: "create" })).toThrow(/20 raid plans an hour/);
    clock.advance(60 * 60_000 + 1);
    expect(user.reservePlan(newRecordId(), { kind: "copy" })).toEqual({ status: "reserved" });
    expect(user.usage().ownedPlans).toBe(21);
  });

  it("refuses the 101st owned plan, and imports skip duplicates without counting toward the hourly rate", () => {
    const user = store();
    for (let index = 0; index < 100; index += 1) user.reservePlan(newRecordId(), { kind: "import", contentHash: `h${index}` });
    expect(user.reservePlan(newRecordId(), { kind: "import", contentHash: "h5" }).status).toBe("duplicate");
    expect(() => user.reservePlan(newRecordId(), { kind: "import", contentHash: "new" })).toThrow(/at most 100 raid plans/);
  });

  it("releases pending reservations after 10 minutes", () => {
    const user = store();
    const id = newRecordId();
    user.reservePlan(id, { kind: "create" });
    clock.advance(10 * 60_000);
    user.sweep();
    expect(user.planEntry(id)).toBeNull();
  });

  it("limits shared plans to 100, accepts ownership past the owned limit, and blocks creating until back under", () => {
    const user = store();
    for (let index = 0; index < 100; index += 1) {
      const id = newRecordId();
      user.reserveShared(id);
      user.setPlanEntry(id, { role: "viewer", summary: { name: "x" } });
    }
    expect(() => user.reserveShared(newRecordId())).toThrow(/At most 100 raid plans/);
    for (let index = 0; index < 100; index += 1) user.reservePlan(newRecordId(), { kind: "import" });
    const handed = user.planIds("shared")[0];
    user.receiveOwnership(handed, { name: "Handed over" }, "You now own Handed over because Ewan left.");
    expect(user.usage()).toMatchObject({ ownedPlans: 101, sharedPlans: 99 });
    expect(() => user.reservePlan(newRecordId(), { kind: "create" })).toThrow(/remove 2 first/);
    expect(user.notices()[0].body).toMatch(/You now own/);
  });

  it("refuses ownership while the account is being deleted", () => {
    const user = store();
    user.beginDeletion();
    expect(() => user.receiveOwnership(newRecordId(), {}, null)).toThrow(/being deleted/);
  });

  it("puts plan index changes in the change log", () => {
    const user = store();
    const id = newRecordId();
    const cursor = user.seq();
    user.reserveShared(id);
    user.setPlanEntry(id, { role: "editor", summary: { name: "Customs run", mapKey: "customs", rev: 4 } });
    user.forgetPlan(id, "You were removed from Customs run.");
    const changes = user.changesSince(cursor);
    expect(changes).toMatchObject({ records: [], tombstones: [{ kind: "plan", id }] });
  });
});
