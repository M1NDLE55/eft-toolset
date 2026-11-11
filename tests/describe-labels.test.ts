// @vitest-environment node
import { describe, expect, it } from "vitest";
import { aboutMetres, describeLabel, direction, region } from "../scripts/describe-labels.mjs";

// A 200 m square map drawn without rotation: +x is east and +z is north.
function map(overrides = {}) {
  return {
    name: "Testmap",
    rotation: 0,
    bounds: [
      [-100, -100],
      [100, 100],
    ],
    landmarks: [],
    exits: [],
    locks: [],
    bosses: [],
    loot: [],
    ...overrides,
  };
}

describe("directions", () => {
  it("follows the map's rotation", () => {
    expect(direction(0, { x: 0, z: 0 }, { x: 0, z: 10 })).toBe("north");
    expect(direction(0, { x: 0, z: 0 }, { x: -10, z: -10 })).toBe("south-west");
    // tarkov.dev draws most maps rotated 180 degrees, so +x is west there.
    expect(direction(180, { x: 0, z: 0 }, { x: 10, z: 0 })).toBe("west");
    expect(direction(270, { x: 0, z: 0 }, { x: 10, z: 0 })).toBe("south");
  });

  it("names the third of the map a point is in", () => {
    const bounds = [
      [-100, -100],
      [100, 100],
    ];
    expect(region(0, bounds, { x: -90, z: 90 })).toBe("the north-west");
    expect(region(0, bounds, { x: 0, z: -90 })).toBe("the south");
    expect(region(0, bounds, { x: 10, z: 10 })).toBe("the middle");
    expect(region(180, bounds, { x: -90, z: 0 })).toBe("the east");
  });

  it("rounds distances to 5 m, or 10 m from 100 m", () => {
    expect(aboutMetres(2)).toBe("about 5 m");
    expect(aboutMetres(47)).toBe("about 45 m");
    expect(aboutMetres(146)).toBe("about 150 m");
  });
});

describe("describeLabel", () => {
  it("places a label by the nearest landmark and exit", () => {
    const text = describeLabel(
      map({
        landmarks: [
          { name: "Far House", x: -90, z: -90 },
          { name: "Red Barn", x: 40, z: 60 },
        ],
        exits: [
          { name: "Gate", kind: "extract", faction: "shared", x: 100, z: 60 },
          { name: "Transit to Elsewhere", kind: "transit", x: -100, z: 60 },
        ],
      }),
      { name: "Hilltop", x: 40, z: 80 }
    );
    expect(text).toBe(
      "In the north-east of Testmap, about 20 m north of Red Barn. The nearest PMC and Scav extract, Gate, is about 65 m east."
    );
  });

  it("names a landmark that is the nearest extract once, as the extract", () => {
    const text = describeLabel(
      map({
        landmarks: [{ name: "Vent", exit: "Ventilation Shaft", x: 5, z: 0 }],
        exits: [{ name: "Ventilation Shaft", kind: "extract", faction: "pmc", x: 5, z: 0 }],
      }),
      { name: "Offices", x: 0, z: 0 }
    );
    expect(text).toBe("In the middle of Testmap, right by the Ventilation Shaft PMC extract.");
  });

  it("lists locks, boss spawns, and containers around the label on its floor", () => {
    const text = describeLabel(
      map({
        locks: [
          { key: "Office key", x: 5, z: 5, y: 1 },
          { key: "Office key", x: 6, z: 5, y: 1 },
          { key: "Roof key", x: 5, z: 5, y: 12 },
          { key: "Far key", x: 80, z: 80 },
        ],
        bosses: [
          { name: "Reshala", x: 10, z: 10 },
          { name: "Raider", x: 10, z: 10 },
          { name: "Infected Tagilla", x: 10, z: 10 },
        ],
        loot: [
          { type: "Toolbox", x: 1, z: 1 },
          { type: "Toolbox", x: 2, z: 1 },
          { type: "Safe", x: 3, z: 1 },
          { type: "Dead Scav", x: 3, z: 1 },
          { type: "Drawer", x: 3, z: 1 },
          { type: "Weapon box", x: 3, z: 1, y: 12 },
        ],
      }),
      { name: "Office", x: 0, z: 0, y: 1 }
    );
    expect(text).toBe(
      "In the middle of Testmap. Nearby: locked doors for the Office key; spawns for Reshala and Raiders; a safe, 2 toolboxes and a dead Scav within 30 m."
    );
  });

  it("calls street labels streets and never compares a label with itself", () => {
    const text = describeLabel(
      map({ landmarks: [{ name: "Main St.", x: 0, z: 0 }], exits: [{ name: "Main St.", kind: "extract", x: 0, z: 0 }] }),
      { name: "Main St.", x: 0, z: 0 }
    );
    expect(text).toBe("A street labelled in the middle of Testmap.");
  });
});
