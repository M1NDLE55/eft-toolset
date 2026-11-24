// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyOps, contentOf, diffPlan, docFromContent, inverseOps, OpError, toRaidPlan, withCurrentBases, type PlanDoc, type PlanOp } from "@/app/lib/sharing/plan-doc";
import { compareOrder, isOrderKey, keyBetween, spreadKeys } from "@/app/lib/sharing/order-key";
import type { PlanContent } from "@/app/lib/sharing/plan-content";

const empty: PlanContent = { name: "Customs run", mapKey: "customs", enabledLayers: [], route: [], drawings: [], notes: [] };

function apply(doc: PlanDoc, ops: PlanOp[], rev: number, by = "alice") {
  return applyOps(doc, ops, { rev, by }).doc;
}

function expectOpError(work: () => unknown, code: OpError["code"], message?: RegExp) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(OpError);
    expect((error as OpError).code).toBe(code);
    if (message) expect((error as OpError).message).toMatch(message);
    return error as OpError;
  }
  throw new Error("Expected an OpError");
}

describe("order keys", () => {
  it("always finds a key between two others, and spreads a new route's keys", () => {
    let keys = spreadKeys(5);
    expect([...keys].sort()).toEqual(keys);
    for (let round = 0; round < 200; round += 1) {
      const index = round % (keys.length - 1);
      const between = keyBetween(keys[index], keys[index + 1]);
      expect(between > keys[index] && between < keys[index + 1]).toBe(true);
      expect(isOrderKey(between)).toBe(true);
      keys = [...keys.slice(0, index + 1), between, ...keys.slice(index + 1)];
    }
    expect(keyBetween(null, null)).toBe("V");
    expect(keyBetween("V", null) > "V").toBe(true);
    expect(keyBetween(null, "1") < "1").toBe(true);
    expect(spreadKeys(300).every((key) => key.length <= 3)).toBe(true);
  });

  it("keeps both of two concurrent inserts at the same place, ordered by id", () => {
    const a = { id: "b", ord: keyBetween("A", "B") };
    const b = { id: "a", ord: keyBetween("A", "B") };
    expect([a, b].sort(compareOrder).map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("applying ops", () => {
  it("is last-writer-wins per field, in the order applied", () => {
    let doc = apply(docFromContent(empty, "alice"), [{ t: "wp.add", id: "w1", at: { x: 1, z: 1 }, ord: "V" }, { t: "note.add", id: "n1", at: { x: 0, z: 0 }, title: "Dorms", body: "", color: "#C8B384" }], 1);
    doc = apply(doc, [{ t: "wp.move", id: "w1", at: { x: 2, z: 2 } }], 2, "bob");
    doc = apply(doc, [{ t: "wp.move", id: "w1", at: { x: 3.14159, z: 3 } }, { t: "note.color", id: "n1", color: "#9bc878" }], 3, "alice");
    expect(doc.waypoints.w1).toMatchObject({ x: 3.14, z: 3, rev: 3, by: "alice" });
    expect(doc.notes.n1.color).toBe("#9bc878");
  });

  it("lets a delete beat a later update, which is refused as gone, and treats a second delete as done", () => {
    const doc = apply(docFromContent(empty, "alice"), [{ t: "wp.add", id: "w1", at: { x: 1, z: 1 }, ord: "V" }], 1);
    const deleted = apply(doc, [{ t: "wp.del", id: "w1" }], 2, "bob");
    expectOpError(() => apply(deleted, [{ t: "wp.move", id: "w1", at: { x: 5, z: 5 } }], 3), "gone");
    expect(apply(deleted, [{ t: "wp.del", id: "w1" }], 3)).toEqual(deleted);
  });

  it("compare-and-sets note text, returning the current text on a clash", () => {
    let doc = apply(docFromContent(empty, "alice"), [{ t: "note.add", id: "n1", at: { x: 0, z: 0 }, title: "Dorms", body: "Key in 314", color: "#c8b384" }], 1);
    doc = apply(doc, [{ t: "note.text", id: "n1", field: "body", value: "Key in 206", base: 1 }], 2, "bob");
    const error = expectOpError(() => apply(doc, [{ t: "note.text", id: "n1", field: "body", value: "Mine", base: 1 }], 3), "conflict");
    expect(error.details).toMatchObject({ field: "body", rev: 2, value: "Key in 206", by: "bob" });
    // The title has its own revision, so editing it doesn't clash with the body edit.
    expect(apply(doc, [{ t: "note.text", id: "n1", field: "title", value: "Dorms 2", base: 1 }], 3).notes.n1).toMatchObject({ title: "Dorms 2", body: "Key in 206" });
  });

  it("makes adds idempotent by id, and rolls a whole batch back when any op fails", () => {
    const doc = apply(docFromContent(empty, "alice"), [{ t: "wp.add", id: "w1", at: { x: 1, z: 1 }, ord: "V" }], 1);
    expect(apply(doc, [{ t: "wp.add", id: "w1", at: { x: 9, z: 9 }, ord: "W" }], 2).waypoints.w1.x).toBe(1);
    expectOpError(() => apply(doc, [{ t: "wp.add", id: "w2", at: { x: 1, z: 1 }, ord: "W" }, { t: "note.move", id: "missing", at: { x: 0, z: 0 } }], 2), "gone");
    expect(doc.waypoints.w2).toBeUndefined();
  });

  it("enforces the approved caps: 300 waypoints, 200 drawings, 2,000 points each, 5,000 in all, 100 notes, 1,000-character notes", () => {
    const route = Array.from({ length: 300 }, (_, index) => ({ id: `w${index}`, position: { x: index, z: 0 } }));
    const full = docFromContent({ ...empty, route }, "alice");
    expectOpError(() => apply(full, [{ t: "wp.add", id: "w300", at: { x: 0, z: 0 }, ord: "z" }], 1), "limit", /300 route points/);
    expectOpError(() => docFromContent({ ...empty, route: [...route, { id: "x", position: { x: 0, z: 0 } }] }, "alice"), "limit");

    const line = (count: number) => Array.from({ length: count }, (_, index) => ({ x: index, z: index }));
    expectOpError(() => apply(full, [{ t: "draw.add", id: "d", kind: "pen", color: "#c8b384", points: line(2001) }], 1), "limit", /2000 points/);
    const three = docFromContent({ ...empty, drawings: [0, 1].map((index) => ({ id: `d${index}`, kind: "pen" as const, color: "#c8b384", points: line(2000) })) }, "alice");
    expectOpError(() => apply(three, [{ t: "draw.add", id: "d2", kind: "pen", color: "#c8b384", points: line(1001) }], 1), "limit", /5000 drawing points/);
    const many = docFromContent({ ...empty, drawings: Array.from({ length: 200 }, (_, index) => ({ id: `d${index}`, kind: "arrow" as const, color: "#c8b384", points: line(2) })) }, "alice");
    expectOpError(() => apply(many, [{ t: "draw.add", id: "x", kind: "arrow", color: "#c8b384", points: line(2) }], 1), "limit", /200 drawings/);

    const notes = docFromContent({ ...empty, notes: Array.from({ length: 100 }, (_, index) => ({ id: `n${index}`, position: { x: 0, z: 0 }, title: "", body: "", color: "#c8b384" })) }, "alice");
    expectOpError(() => apply(notes, [{ t: "note.add", id: "x", at: { x: 0, z: 0 }, title: "", body: "", color: "#c8b384" }], 1), "limit", /100 notes/);
    expectOpError(() => apply(full, [{ t: "note.add", id: "x", at: { x: 0, z: 0 }, title: "", body: "a".repeat(1001), color: "#c8b384" }], 1), "limit", /1000 characters/);
  });

  it("enforces the 256 KiB size cap even within the item caps", () => {
    const body = "€".repeat(1000); // three bytes each in UTF-8
    const notes = Array.from({ length: 99 }, (_, index) => ({ id: `n${index}`, position: { x: 0, z: 0 }, title: "", body, color: "#c8b384" }));
    const doc = docFromContent({ ...empty, notes: notes.slice(0, 50) }, "alice");
    const error = expectOpError(
      () => apply(doc, notes.slice(50, 99).map((note) => ({ t: "note.add" as const, id: note.id, at: note.position, title: "", body, color: note.color })), 1),
      "limit",
      /256 KB/
    );
    expect(error.details?.used).toBeGreaterThan(256 * 1024);
  });

  it("refuses malformed ops", () => {
    const doc = docFromContent(empty, "alice");
    for (const op of [{ t: "nope" }, { t: "wp.add", id: "w", at: { x: "1", z: 0 }, ord: "V" }, { t: "wp.add", id: "w", at: { x: 1, z: 0 }, ord: "V0" }, { t: "note.color", id: "n", color: "red" }, { t: "plan.rename", name: "  " }]) {
      expectOpError(() => applyOps(doc, [op], { rev: 1, by: "a" }), "invalid");
    }
    expectOpError(() => applyOps(doc, Array.from({ length: 51 }, () => ({ t: "layer.on", layer: "x" })), { rev: 1, by: "a" }), "invalid", /at most 50/);
  });
});

describe("editor diffs and undo", () => {
  const start = docFromContent(
    {
      ...empty,
      enabledLayers: ["extracts:pmc"],
      route: [
        { id: "a", position: { x: 0, z: 0 } },
        { id: "b", position: { x: 1, z: 1 } },
        { id: "c", position: { x: 2, z: 2 } },
      ],
      drawings: [{ id: "d1", kind: "pen", color: "#c8b384", points: [{ x: 0, z: 0 }, { x: 1, z: 1 }] }],
      notes: [{ id: "n1", position: { x: 5, z: 5 }, title: "Dorms", body: "", color: "#c8b384" }],
    },
    "alice",
    3
  );
  const plan = toRaidPlan(start, "p", { createdAt: 0, updatedAt: 0 });

  it("turns an edited plan into a small batch that reproduces it", () => {
    const next = {
      ...plan,
      name: "Customs night",
      enabledLayers: ["spawns:boss"],
      route: [plan.route[0], { id: "new", position: { x: 0.5, z: 0.5 } }, plan.route[2], { ...plan.route[1], position: { x: 9, z: 9 } }],
      drawings: [],
      notes: [{ ...plan.notes[0], title: "Dorms 314", position: { x: 6, z: 6 } }],
    };
    const ops = diffPlan(start, next);
    expect(ops.map((op) => op.t).sort()).toEqual(["draw.del", "layer.off", "layer.on", "note.move", "note.text", "plan.rename", "wp.add", "wp.move", "wp.order"].sort());
    const after = apply(start, ops, 4);
    const content = contentOf(after);
    expect(content.route.map((waypoint) => waypoint.id)).toEqual(["a", "new", "c", "b"]);
    expect(content).toMatchObject({ name: "Customs night", enabledLayers: ["spawns:boss"], drawings: [], notes: [{ title: "Dorms 314", position: { x: 6, z: 6 } }] });
  });

  it("undoes a batch with inverse ops that touch only what it changed", () => {
    const ops: PlanOp[] = [
      { t: "wp.move", id: "a", at: { x: 7, z: 7 } },
      { t: "note.del", id: "n1" },
      { t: "draw.add", id: "d2", kind: "arrow", color: "#d46b6b", points: [{ x: 0, z: 0 }, { x: 3, z: 3 }] },
    ];
    const after = apply(start, ops, 4);
    // Someone else moves b meanwhile; undo must not touch it.
    const meanwhile = apply(after, [{ t: "wp.move", id: "b", at: { x: 50, z: 50 } }], 5, "bob");
    let counter = 0;
    const undo = withCurrentBases(meanwhile, inverseOps(start, ops, () => `restored${(counter += 1)}`));
    const undone = contentOf(apply(meanwhile, undo, 6));
    expect(undone.route.find((waypoint) => waypoint.id === "a")?.position).toEqual({ x: 0, z: 0 });
    expect(undone.route.find((waypoint) => waypoint.id === "b")?.position).toEqual({ x: 50, z: 50 });
    expect(undone.drawings.map((drawing) => drawing.id)).toEqual(["d1"]);
    expect(undone.notes).toEqual([{ id: "restored1", position: { x: 5, z: 5 }, title: "Dorms", body: "", color: "#c8b384" }]);
  });
});
