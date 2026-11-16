import { describe, expect, it } from "vitest";
import type { BuildItemData, BuildNode } from "@/app/lib/types/gunBuilder";
import type { WeaponBuildObjective } from "@/app/lib/api/tarkov-server";
import { checkRequirements, placeRequiredParts, sightingRange, skeleton, solveGunsmith, type GunsmithContext } from "@/app/lib/builds/gunsmith";
import type { PartLookup } from "@/app/lib/builds/resolve";

function slot(id: string, nameId: string, allowed: string[], required = false) {
  return { id, name: id, nameId, required, allowedItemIds: allowed };
}

function part(id: string, overrides: Partial<BuildItemData> = {}): BuildItemData {
  return {
    id,
    name: id,
    shortName: id,
    gridImageLink: null,
    weight: 0.1,
    traderPriceRUB: 1_000,
    fleaPriceRUB: null,
    ergonomics: 0,
    recoilModifier: 0,
    recoilVertical: null,
    recoilHorizontal: null,
    isWeapon: false,
    conflictingItemIds: [],
    conflictingSlotIds: [],
    slots: [],
    ...overrides,
  };
}

// A rifle whose foregrip only fits the railed handguard, and whose long-range scope needs a mount.
const items = [
  part("rifle", {
    isWeapon: true,
    weight: 3,
    ergonomics: 40,
    recoilVertical: 100,
    recoilHorizontal: 200,
    sightingRange: 100,
    slots: [
      slot("hg", "mod_handguard", ["plain-hg", "rail-hg"]),
      slot("mag", "mod_magazine", ["mag-30", "mag-60"]),
      slot("scope", "mod_scope", ["mount", "red-dot"]),
    ],
  }),
  part("plain-hg", { ergonomics: 5 }),
  part("rail-hg", { ergonomics: 2, slots: [slot("grip", "mod_foregrip", ["grip"])] }),
  part("grip", { ergonomics: 4, recoilModifier: -0.05 }),
  part("mag-30", { capacity: 30 }),
  part("mag-60", { capacity: 60, ergonomics: -5, weight: 0.5 }),
  part("mount", { slots: [slot("optic", "mod_scope", ["long-scope"])] }),
  part("long-scope", { sight: "optic", sightingRange: 800, weight: 0.4 }),
  part("red-dot", { sight: "optic", sightingRange: 100 }),
];
const lookup: PartLookup = new Map(items.map((item) => [item.id, item]));
const context: GunsmithContext = {
  lookup,
  sources: { traders: true, flea: true },
  inCategory: () => false,
  preset: null,
};
const priorities = { weight: false, recoil: true, ergonomics: true };

describe("gunsmith solver", () => {
  it("installs a required part with the part it hangs from", () => {
    const locked = new Set(["rifle"]);
    const start: BuildNode = { itemId: "rifle", slots: { hg: { itemId: "plain-hg", slots: {} } } };
    const placed = placeRequiredParts(start, context, ["grip"], locked, priorities);
    expect(placed.unplaced).toEqual([]);
    expect(placed.root.slots.hg).toEqual({ itemId: "rail-hg", slots: { grip: { itemId: "grip", slots: {} } } });
    expect(locked.has("rail-hg")).toBe(true);
  });

  it("keeps locked parts and what holds them when trimming the build", () => {
    const root: BuildNode = {
      itemId: "rifle",
      slots: { hg: { itemId: "rail-hg", slots: { grip: { itemId: "grip", slots: {} } } }, mag: { itemId: "mag-30", slots: {} } },
    };
    expect(skeleton(root, new Set(["rifle", "grip"]))).toEqual({
      itemId: "rifle",
      slots: { hg: { itemId: "rail-hg", slots: { grip: { itemId: "grip", slots: {} } } } },
    });
  });

  it("checks recoil as the sum of vertical and horizontal, and sighting range from the best sight", () => {
    const objective: WeaponBuildObjective = {
      weaponId: "rifle",
      containsAll: ["grip"],
      containsCategory: [],
      requirements: [
        { name: "recoil", compareMethod: "<=", value: 290 },
        { name: "effectiveDistance", compareMethod: ">=", value: 800 },
        { name: "durability", compareMethod: ">=", value: 60 },
      ],
    };
    const root: BuildNode = {
      itemId: "rifle",
      slots: {
        hg: { itemId: "rail-hg", slots: { grip: { itemId: "grip", slots: {} } } },
        scope: { itemId: "mount", slots: { optic: { itemId: "long-scope", slots: {} } } },
      },
    };
    expect(sightingRange(root, lookup)).toBe(800);
    const check = checkRequirements(root, objective, context);
    expect(check.checks.map((entry) => [entry.name, entry.actual, entry.status])).toEqual([
      ["recoil", 285, "pass"],
      ["effectiveDistance", 800, "pass"],
      ["durability", null, "unknown"],
    ]);
    expect(check.passes).toBe(true);
  });

  it("solves a task that needs a part on a different handguard, a long-range scope and a big magazine", async () => {
    const objective: WeaponBuildObjective = {
      weaponId: "rifle",
      containsAll: ["grip"],
      containsCategory: [],
      requirements: [
        { name: "effectiveDistance", compareMethod: ">=", value: 500 },
        { name: "magazineCapacity", compareMethod: ">=", value: 60 },
        { name: "ergonomics", compareMethod: ">=", value: 35 },
      ],
    };
    const solution = await solveGunsmith(objective, { itemId: "rifle", slots: { hg: { itemId: "plain-hg", slots: {} } } }, context);
    expect(solution.build).not.toBeNull();
    expect(solution.check.passes).toBe(true);
    expect(solution.build!.slots.scope).toEqual({ itemId: "mount", slots: { optic: { itemId: "long-scope", slots: {} } } });
    expect(solution.build!.slots.mag.itemId).toBe("mag-60");
  });

  it("reports no build when a limit can't be met", async () => {
    const objective: WeaponBuildObjective = {
      weaponId: "rifle",
      containsAll: [],
      containsCategory: [],
      requirements: [{ name: "weight", compareMethod: "<=", value: 2 }],
    };
    const solution = await solveGunsmith(objective, null, context);
    expect(solution.build).toBeNull();
    expect(solution.check.checks[0].status).toBe("fail");
  });
});
