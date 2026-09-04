import { beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "@/app/lib/raid-planner/store";
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
});
