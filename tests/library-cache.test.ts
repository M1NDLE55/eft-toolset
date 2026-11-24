// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  actionFor,
  clashesWith,
  foldQueue,
  rebase,
  remoteChangedFields,
  type QueueEntry,
} from "@/app/lib/account-sync/library-cache";
import { chunkForImport, migrationCandidates, preselect } from "@/app/lib/account-sync/migration";
import { buildHash } from "@/app/lib/sharing/content-hash";
import type { BuildRecord, GroupRecord, Mutation } from "@/app/lib/sharing/types";
import type { RaidPlan } from "@/app/lib/raid-planner/types";

const now = 1_800_000_000_000;

const server: BuildRecord = {
  kind: "build",
  id: "AAAAAAAAAAAAAAAAAAAAAA",
  version: 3,
  name: "AK",
  weaponId: "ak",
  root: { itemId: "ak", slots: { mod_stock: { itemId: "stock1", slots: {} }, mod_gas_block: { itemId: "gas1", slots: {} } } },
  allowCopy: true,
  origin: "created",
  copiedFrom: null,
  contentHash: "",
  createdAt: now,
  updatedAt: now,
};

const key = `build:${server.id}`;
const patch = (mutationId: string, baseVersion: number, body: object): QueueEntry => ({
  key,
  mutation: { mutationId, kind: "build", op: "patch", id: server.id, baseVersion, patch: body } as Mutation,
});

describe("queue folding", () => {
  it("folds consecutive patches into one, keeping the earliest base version and the latest value per field", () => {
    const folded = foldQueue([patch("m1", 3, { name: "a" }), patch("m2", 3, { name: "b", slots: { mod_stock: "stock2" } }), patch("m3", 4, { ammoId: "bp" })], now);
    expect(folded).toHaveLength(1);
    expect(folded[0].mutation).toMatchObject({ mutationId: "m3", baseVersion: 3, patch: { name: "b", ammoId: "bp", slots: { mod_stock: "stock2" } } });
  });

  it("turns a create followed by edits into one create, and drops a create followed by a delete", () => {
    const create: QueueEntry = { key: "item_group:g", mutation: { mutationId: "c", kind: "item_group", op: "create", id: "g", value: { name: "Keys", items: ["a"] } } };
    const edit: QueueEntry = { key: "item_group:g", mutation: { mutationId: "e", kind: "item_group", op: "patch", id: "g", baseVersion: 0, patch: { add: ["b"], name: "Keys 2" } } };
    expect(foldQueue([create, edit], now)[0].mutation).toMatchObject({ op: "create", value: { name: "Keys 2", items: ["a", "b"] } });
    const remove: QueueEntry = { key: "item_group:g", mutation: { mutationId: "d", kind: "item_group", op: "delete", id: "g", baseVersion: 0 } };
    expect(foldQueue([create, edit, remove], now)[0].mutation).toBeNull();
  });

  it("keeps the earliest base when an edit is followed by a delete", () => {
    const folded = foldQueue([patch("m1", 3, { name: "a" }), { key, mutation: { mutationId: "d", kind: "build", op: "delete", id: server.id, baseVersion: 4 } }], now);
    expect(folded[0].mutation).toMatchObject({ op: "delete", baseVersion: 3 });
  });
});

describe("rebasing", () => {
  it("shows the server copy with this device's queued changes on top", () => {
    const local = rebase(server, [patch("m1", 3, { name: "Mine" }).mutation], now) as BuildRecord;
    expect(local.name).toBe("Mine");
    expect(local.root.slots.mod_stock.itemId).toBe("stock1");
    expect(rebase({ ...server, deleted: true }, [], now)).toBeNull();
  });
});

describe("results", () => {
  it("splits a conflicting patch: clashing fields wait for a choice, the rest goes ahead", () => {
    const mutation = patch("m1", 2, { name: "Mine", slots: { mod_stock: "stock9" } }).mutation;
    const action = actionFor(
      { mutationId: "m1", status: "conflict", fields: ["slot:mod_stock"], mine: (mutation as { patch: object }).patch, theirs: { version: 3, record: server } },
      mutation,
      server
    );
    expect(action).toMatchObject({ type: "conflict", conflict: { type: "fields", mine: { slots: { mod_stock: "stock9" } } }, rest: { name: "Mine" } });
  });

  it("re-creates a record the server purged, and drops a delete of it", () => {
    expect(actionFor({ mutationId: "m", status: "rejected", code: "gone", message: "" }, patch("m", 1, { name: "x" }).mutation, server).type).toBe("recreate");
    expect(actionFor({ mutationId: "m", status: "rejected", code: "gone", message: "" }, { mutationId: "m", kind: "build", op: "delete", id: "x", baseVersion: 1 }, null).type).toBe("drop");
    expect(actionFor({ mutationId: "m", status: "rejected", code: "rate_limited", message: "", details: { retryAfterSeconds: 7 } }, patch("m", 1, {}).mutation, null)).toEqual({ type: "retry", afterSeconds: 7 });
    expect(actionFor({ mutationId: "m", status: "rejected", code: "limit", message: "Full" }, patch("m", 1, {}).mutation, server).type).toBe("problem");
  });

  it("finds what another device changed when a write came back merged, so later edits to those fields still clash", () => {
    const expected = { ...server, name: "Mine" };
    const actual = { ...expected, version: 5, root: { ...server.root, slots: { ...server.root.slots, mod_gas_block: { itemId: "gas2", slots: {} } } } };
    const remote = remoteChangedFields(expected, actual);
    expect(remote).toEqual(["slot:mod_gas_block"]);
    expect(clashesWith("build", { slots: { "mod_gas_block/mod_handguard": "hg" } }, remote)).toHaveLength(1);
    expect(clashesWith("build", { slots: { mod_stock: "s" } }, remote)).toEqual([]);
    const group: GroupRecord = { ...server, kind: "item_group", items: [] } as unknown as GroupRecord;
    expect(remoteChangedFields(group, { ...group, name: "Other" })).toEqual(["name"]);
  });
});

describe("migration selection", () => {
  const plan = (id: string, overrides: Partial<RaidPlan> = {}): RaidPlan => ({
    id,
    name: id,
    mapKey: "customs",
    createdAt: now,
    updatedAt: now,
    enabledLayers: [],
    route: [],
    drawings: [],
    notes: [],
    ...overrides,
  });

  it("leaves out what the account already has, flags plans over the caps, and preselects the newest that fit", () => {
    const builds = [1, 2, 3].map((index) => ({ id: `b${index}`, name: `B${index}`, weaponId: "ak", root: { itemId: "ak", slots: {} }, createdAt: index, updatedAt: index }));
    const candidates = migrationCandidates(
      { builds, groups: [], plans: [plan("small"), plan("huge", { notes: Array.from({ length: 101 }, (_, index) => ({ id: `n${index}`, position: { x: 0, z: 0 }, title: "", body: "", color: "#c8b384" })) })] },
      { builds: [buildHash(builds[0])], itemGroups: [], plans: [] }
    );
    expect(candidates.map((candidate) => candidate.key)).toEqual(["b2", "b3", "small", "huge"]);
    expect(candidates.find((candidate) => candidate.key === "huge")?.blocked).toMatch(/more than 100 notes/);
    expect([...preselect(candidates, { build: 1, item_group: 0, plan: 5 })]).toEqual(["build:b3", "plan:small"]);
  });
});

describe("import batches", () => {
  it("hold at most 50 items and stay under the request size, however large the items", () => {
    const small = Array.from({ length: 120 }, () => 1_000);
    expect(chunkForImport(small, (size) => size).map((batch) => batch.length)).toEqual([50, 50, 20]);
    const plans = Array.from({ length: 7 }, () => 250 * 1024);
    const batches = chunkForImport(plans, (size) => size);
    expect(batches.map((batch) => batch.length)).toEqual([3, 3, 1]);
    expect(batches.every((batch) => batch.reduce((total, size) => total + size, 0) < 1024 * 1024)).toBe(true);
  });
});
