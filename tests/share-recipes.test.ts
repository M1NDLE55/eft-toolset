import { describe, expect, it } from "vitest";
import { encodeSharePayload } from "@/app/lib/share-codec";
import { createShareRecipe, decodeBuildSharePayload } from "@/app/lib/builds/share";
import { createPlanShareRecipe, decodePlanSharePayload } from "@/app/lib/raid-planner/share";

describe("shared recipe validation", () => {
  it("rejects a build whose root does not match its weapon", async () => {
    const payload = await encodeSharePayload({ v: 1, w: "weapon", r: ["different"] });
    await expect(decodeBuildSharePayload(payload)).rejects.toThrow(/tree is invalid/i);
  });

  it("rejects duplicate build slot identifiers", async () => {
    const payload = await encodeSharePayload({
      v: 1,
      w: "weapon",
      r: ["weapon", [["slot", ["a"]], ["slot", ["b"]]]],
    });
    await expect(decodeBuildSharePayload(payload)).rejects.toThrow(/tree is invalid/i);
  });

  it("rejects unsupported drawing colors and non-finite coordinates", async () => {
    const badColor = await encodeSharePayload({
      v: 1,
      m: "customs",
      d: [["pen", "javascript:alert(1)", [[0, 0], [1, 1]]]],
    });
    await expect(decodePlanSharePayload(badColor)).rejects.toThrow(/drawings are invalid/i);

    const badPoint = await encodeSharePayload({ v: 1, m: "customs", r: [[1e20, 0]] });
    await expect(decodePlanSharePayload(badPoint)).rejects.toThrow(/route is invalid/i);
  });

  it("enforces the same limits when creating outbound links", () => {
    expect(() =>
      createPlanShareRecipe({
        id: "plan",
        name: "Plan",
        mapKey: "customs",
        createdAt: 0,
        updatedAt: 0,
        enabledLayers: [],
        route: [],
        drawings: Array.from({ length: 5 }, (_, drawing) => ({
          id: String(drawing),
          kind: "pen" as const,
          color: "#c8b384",
          points: Array.from({ length: 5_000 }, (_, point) => ({ x: point, z: 0 })),
        })),
        notes: [],
      })
    ).toThrow(/safe sharing limits/i);

    expect(() =>
      createShareRecipe({
        id: "build",
        name: "x".repeat(121),
        weaponId: "weapon",
        root: { itemId: "weapon", slots: {} },
        createdAt: 0,
        updatedAt: 0,
      })
    ).toThrow(/safe sharing limits/i);

    expect(() =>
      createPlanShareRecipe({
        id: "plan",
        name: "Plan",
        mapKey: "customs",
        createdAt: 0,
        updatedAt: 0,
        enabledLayers: [],
        route: [{ id: "waypoint", position: { x: Number.NaN, z: 0 } }],
        drawings: [],
        notes: [],
      })
    ).toThrow(/safe sharing limits/i);
  });

  it("normalizes stored drawing colors before they enter a shared payload", () => {
    const recipe = createPlanShareRecipe({
      id: "plan",
      name: "Plan",
      mapKey: "customs",
      createdAt: 0,
      updatedAt: 0,
      enabledLayers: [],
      route: [],
      drawings: [
        {
          id: "drawing",
          kind: "pen",
          color: "red; background:url(javascript:alert(1))",
          points: [{ x: 0, z: 0 }, { x: 1, z: 1 }],
        },
      ],
      notes: [],
    });

    expect(recipe.d?.[0][1]).toBe("#c8b384");
  });
});
