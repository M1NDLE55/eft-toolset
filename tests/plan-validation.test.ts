import { beforeEach, describe, expect, it } from "vitest";
import { createPlan, importPlan } from "@/app/lib/raid-planner/store";
import { MAX_PLAN_NAME_LENGTH, MAX_PLANS } from "@/app/lib/raid-planner/limits";
import { getPlanDisplayColor, PLAN_COLORS } from "@/app/lib/raid-planner/types";

describe("raid-plan validation", () => {
  beforeEach(() => localStorage.clear());

  it("falls back to a trusted display color", () => {
    expect(getPlanDisplayColor("red; background:url(javascript:alert(1))")).toBe(
      PLAN_COLORS[0]
    );
  });

  it("rejects plans whose combined drawing points exceed the store cap", () => {
    expect(() =>
      importPlan({
        name: "Oversized",
        mapKey: "customs",
        enabledLayers: [],
        route: [],
        drawings: Array.from({ length: 5 }, (_, drawing) => ({
          id: String(drawing),
          kind: "pen" as const,
          color: PLAN_COLORS[0],
          points: Array.from({ length: 5_000 }, (_, point) => ({ x: point, z: 0 })),
        })),
        notes: [],
      })
    ).toThrow(/refusing to persist invalid/i);
  });

  it("explains the plan cap instead of failing validation", () => {
    const plans = Array.from({ length: MAX_PLANS }, (_, index) => ({
      id: `plan-${index}`,
      name: `Plan ${index}`,
      mapKey: "customs",
      createdAt: 0,
      updatedAt: 0,
      enabledLayers: [],
      route: [],
      drawings: [],
      notes: [],
    }));
    localStorage.setItem("eft-toolset:raid-plans", JSON.stringify({ version: 1, data: plans }));
    expect(() => createPlan("One more", "customs")).toThrow(/at most 500 plans/i);
  });

  it("trims and bounds plan names on creation", () => {
    expect(createPlan("   ", "customs").name).toBe("Untitled raid");
    expect(createPlan("x".repeat(500), "customs").name).toHaveLength(MAX_PLAN_NAME_LENGTH);
  });
});

