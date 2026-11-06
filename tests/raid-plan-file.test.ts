import { beforeEach, describe, expect, it } from "vitest";
import {
  createPlanFile,
  MAX_PLAN_FILE_BYTES,
  parsePlanFile,
  planFileName,
  PLAN_FILE_FORMAT,
  readPlanFile,
} from "@/app/lib/raid-planner/plan-file";
import { importPlans, PLAN_STORE } from "@/app/lib/raid-planner/store";
import { readStore } from "@/app/lib/storage/versioned-store";
import { MAX_PLANS, MAX_TOTAL_DRAWING_POINTS } from "@/app/lib/raid-planner/limits";
import type { RaidPlan } from "@/app/lib/raid-planner/types";

function plan(overrides: Partial<RaidPlan> = {}): RaidPlan {
  return {
    id: "plan-1",
    name: "Dorms rush",
    mapKey: "customs",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    enabledLayers: ["extracts:pmc"],
    route: [{ id: "w1", position: { x: 1, z: 2 } }],
    drawings: [{ id: "d1", kind: "arrow", color: "#d46b6b", points: [{ x: 0, z: 0 }, { x: 10, z: 5 }] }],
    notes: [{ id: "n1", position: { x: 3, z: 4 }, title: "Key", body: "Dorms 314", color: "#e2a852" }],
    ...overrides,
  };
}

function fileWith(plans: unknown, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ format: PLAN_FILE_FORMAT, version: 1, exportedAt: "2026-01-01T00:00:00.000Z", plans, ...extra });
}

describe("raid plan files", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips exported plans", () => {
    const plans = [plan(), plan({ id: "plan-2", name: "Woods", mapKey: "woods" })];
    expect(parsePlanFile(createPlanFile(plans))).toEqual(plans);
  });

  it("names single-plan and multi-plan exports", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    expect(planFileName([plan()], now)).toBe("raid-plan-dorms-rush.json");
    expect(planFileName([plan(), plan()], now)).toBe("raid-plans-2026-11-06.json");
  });

  it("rejects files that are not plan exports", () => {
    expect(() => parsePlanFile("not json")).toThrow(/isn't valid JSON/);
    expect(() => parsePlanFile("[]")).toThrow(/isn't a raid plan file/);
    expect(() => parsePlanFile(JSON.stringify({ format: "other", version: 1, plans: [] }))).toThrow(/isn't a raid plan file/);
    expect(() => parsePlanFile(fileWith([plan()], { version: 2 }))).toThrow(/newer version/);
    expect(() => parsePlanFile(fileWith([plan()], { version: "1" }))).toThrow(/unsupported version/);
    expect(() => parsePlanFile(fileWith([]))).toThrow(/doesn't contain any plans/);
    expect(() => parsePlanFile(fileWith({}))).toThrow(/doesn't contain any plans/);
  });

  it("explains which plan is invalid", () => {
    expect(() => parsePlanFile(fileWith([plan(), plan({ name: "Bad colors", drawings: [{ id: "d", kind: "pen", color: "red", points: [{ x: 0, z: 0 }, { x: 1, z: 1 }] }] })]))).toThrow(
      'Plan 2 ("Bad colors") has invalid drawings.'
    );
    expect(() => parsePlanFile(fileWith([plan({ mapKey: "atlantis" })]))).toThrow(/uses a map that isn't available/);
    expect(() => parsePlanFile(fileWith([plan({ route: [{ id: "w", position: { x: Infinity, z: 0 } }] })]))).toThrow(
      /invalid route/
    );
    expect(() => parsePlanFile(fileWith([plan({ route: [{ id: "w", position: { x: 2_000_000, z: 0 } }] })]))).toThrow(
      /invalid route/
    );
    expect(() => parsePlanFile(fileWith([plan({ notes: [{ id: "n", position: { x: 0, z: 0 }, title: "x".repeat(121), body: "", color: "#ffffff" }] })]))).toThrow(
      /invalid notes/
    );
    expect(() => parsePlanFile(fileWith(["nope"]))).toThrow("Plan 1 is not a plan.");
  });

  it("enforces the combined drawing cap", () => {
    const points = Array.from({ length: 5_000 }, (_, index) => ({ x: index, z: 0 }));
    const drawings = Array.from({ length: MAX_TOTAL_DRAWING_POINTS / 5_000 + 1 }, (_, index) => ({
      id: `d${index}`,
      kind: "pen" as const,
      color: "#c8b384",
      points,
    }));
    expect(() => parsePlanFile(fileWith([plan({ drawings })]))).toThrow(/more drawing detail/);
  });

  it("caps the number of plans and the file size", async () => {
    expect(() => parsePlanFile(fileWith(Array.from({ length: MAX_PLANS + 1 }, () => plan())))).toThrow(/At most 500/);
    expect(() => parsePlanFile(" ".repeat(MAX_PLAN_FILE_BYTES + 1))).toThrow(/too large/);
    const huge = { size: MAX_PLAN_FILE_BYTES + 1, text: () => Promise.reject(new Error("should not read")) } as unknown as Blob;
    await expect(readPlanFile(huge)).rejects.toThrow(/too large/);
    await expect(readPlanFile(new Blob([]))).rejects.toThrow(/empty/);
    await expect(readPlanFile(new Blob([createPlanFile([plan()])]))).resolves.toHaveLength(1);
  });

  it("drops unknown fields instead of persisting them", () => {
    const tainted = JSON.parse(createPlanFile([plan()]));
    tainted.plans[0].html = "<img src=x onerror=alert(1)>";
    tainted.plans[0].notes[0].onclick = "alert(1)";
    tainted.plans[0].route[0].position.w = 5;
    const [parsed] = parsePlanFile(JSON.stringify(tainted));
    expect(parsed).not.toHaveProperty("html");
    expect(parsed.notes[0]).not.toHaveProperty("onclick");
    expect(parsed.route[0].position).toEqual({ x: 1, z: 2 });
  });

  it("imports plans with fresh ids next to existing ones", () => {
    const [first] = importPlans([plan()]);
    const [second] = importPlans([plan({ name: "   " })]);
    const stored = readStore(PLAN_STORE);
    expect(stored).toHaveLength(2);
    expect(first.id).not.toBe("plan-1");
    expect(first.id).not.toBe(second.id);
    expect(second.name).toBe("Imported plan");
    expect(first.route[0].id).not.toBe("w1");
    expect(first.createdAt).toBe(1_700_000_000_000);
  });

  it("refuses imports that would exceed the plan cap", () => {
    importPlans(Array.from({ length: MAX_PLANS - 1 }, () => plan()));
    expect(() => importPlans([plan(), plan()])).toThrow(/only room for 1 more/);
    expect(readStore(PLAN_STORE)).toHaveLength(MAX_PLANS - 1);
  });
});
