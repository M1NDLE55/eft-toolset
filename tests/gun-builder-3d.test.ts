import { describe, expect, it } from "vitest";
import type { BuildItemData, BuildNode, ModSlotDef } from "@/app/lib/types/gunBuilder";
import {
  buildScene,
  lengthFromName,
  slotKind,
  weaponClass,
  type ScenePart,
} from "@/app/lib/builds/build-scene";
import { attachMod } from "@/app/lib/builds/tree";
import { VIEW_STORE, setHideEmptySlots, setShow3d } from "@/app/lib/builds/store";
import { readStore } from "@/app/lib/storage/versioned-store";

function slot(id: string, nameId: string, allowed: string[], extra: Partial<ModSlotDef> = {}): ModSlotDef {
  return { id, name: id, nameId, required: false, allowedItemIds: allowed, ...extra };
}

function item(id: string, name: string, slots: ModSlotDef[] = [], extra: Partial<BuildItemData> = {}): BuildItemData {
  return {
    id,
    name,
    shortName: id,
    gridImageLink: null,
    weight: 1,
    traderPriceRUB: 100,
    fleaPriceRUB: null,
    ergonomics: 0,
    recoilModifier: 0,
    recoilVertical: null,
    recoilHorizontal: null,
    isWeapon: false,
    conflictingItemIds: [],
    conflictingSlotIds: [],
    slots,
    ...extra,
  };
}

function lookup(...items: BuildItemData[]) {
  return new Map(items.map((entry) => [entry.id, entry]));
}

function node(itemId: string, slots: Record<string, BuildNode> = {}): BuildNode {
  return { itemId, slots };
}

const front = (part: ScenePart) => part.center[0] + part.size[0] / 2;
const rear = (part: ScenePart) => part.center[0] - part.size[0] / 2;
const top = (part: ScenePart) => part.center[1] + part.size[1] / 2;
const bottom = (part: ScenePart) => part.center[1] - part.size[1] / 2;

function find(parts: ScenePart[], id: string) {
  const part = parts.find((entry) => entry.id === id);
  if (!part) throw new Error(`No part ${id}; have ${parts.map((entry) => entry.id).join(", ")}`);
  return part;
}

// An AR-style rifle: the barrel and handguard hang off the upper receiver.
const ar = lookup(
  item("m4", "Test M4 5.56x45 assault rifle", [
    slot("m4-grip", "mod_pistol_grip", ["grip"]),
    slot("m4-mag", "mod_magazine", ["mag"], { required: true }),
    slot("m4-upper", "mod_reciever", ["upper"], { required: true }),
    slot("m4-stock", "mod_stock", ["tube"]),
  ], { isWeapon: true }),
  item("grip", "AR-15 pistol grip"),
  item("mag", "STANAG 30-round magazine", [], { capacity: 30, gridWidth: 1, gridHeight: 2 }),
  item("upper", "M4 upper receiver", [
    slot("upper-barrel", "mod_barrel", ["barrel-14", "barrel-20"], { required: true }),
    slot("upper-guard", "mod_handguard", ["guard"], { required: true }),
    slot("upper-scope", "mod_scope", ["scope"]),
  ]),
  item("barrel-14", "AR-15 14.5 inch barrel", [slot("barrel-muzzle", "mod_muzzle", ["brake"])]),
  item("barrel-20", "AR-15 20 inch barrel", [slot("barrel-muzzle", "mod_muzzle", ["brake"])]),
  item("brake", "Test muzzle brake", [slot("brake-muzzle", "mod_muzzle", ["can"])]),
  item("can", "Test sound suppressor", [], { gridWidth: 2 }),
  item("guard", "AR-15 10 inch handguard", [
    slot("guard-top", "mod_mount_000", ["top-rail"]),
    slot("guard-side", "mod_mount_001", ["side-rail"]),
    slot("guard-light", "mod_tactical_000", ["light"]),
  ]),
  item("top-rail", "Test top rail"),
  item("side-rail", "Test side rail", [slot("side-scope", "mod_scope", ["dot"])]),
  item("dot", "Test reflex sight", [], { sight: "optic", gridWidth: 1 }),
  item("light", "Test tactical flashlight"),
  item("scope", "Test 4x scope", [], { sight: "optic", gridWidth: 2 }),
  item("tube", "AR-15 buffer tube", [slot("tube-stock", "mod_stock_000", ["stock"])]),
  item("stock", "Test stock", [], { gridWidth: 2 })
);

const arBuild = node("m4", {
  "m4-grip": node("grip"),
  "m4-mag": node("mag"),
  "m4-upper": node("upper", {
    "upper-barrel": node("barrel-14", { "barrel-muzzle": node("brake", { "brake-muzzle": node("can") }) }),
    "upper-guard": node("guard", {
      "guard-top": node("top-rail"),
      "guard-side": node("side-rail", { "side-scope": node("dot") }),
      "guard-light": node("light"),
    }),
    "upper-scope": node("scope"),
  }),
  "m4-stock": node("tube", { "tube-stock": node("stock") }),
});

describe("3D scene: names and kinds", () => {
  it("reads lengths written in inches or millimetres", () => {
    expect(lengthFromName("AR-15 5.56x45 14.5 inch barrel")).toBeCloseTo(36.83);
    expect(lengthFromName("SVD 7.62x54R 565mm barrel")).toBeCloseTo(56.5);
    expect(lengthFromName("KRISS Vector .45 ACP 5 inch barrel")).toBeCloseTo(12.7);
    expect(lengthFromName("AI AXMC AX KeySlot 16 inch handguard")).toBeCloseTo(40.64);
    expect(lengthFromName("AK-74 5.45x39 muzzle brake")).toBeNull();
  });

  it("classifies slots by their name id, including odd spellings", () => {
    expect(slotKind("mod_pistol_grip")).toBe("grip");
    expect(slotKind("mod_pistolgrip")).toBe("grip");
    expect(slotKind("mod_reciever")).toBe("receiver");
    expect(slotKind("mod_mount_001")).toBe("mount");
    expect(slotKind("mod_muzzle_000")).toBe("muzzle");
    expect(slotKind("mod_sight_front")).toBe("ironSight");
    expect(slotKind("mod_stock_akms")).toBe("stock");
    expect(slotKind("mod_gas_block")).toBe("gasBlock");
    expect(slotKind("mod_something_new")).toBe("other");
  });

  it("tells weapon classes apart without mistaking a pistol grip for a pistol", () => {
    expect(weaponClass("Glock 17 9x19 pistol")).toBe("pistol");
    expect(weaponClass("HK MP5 9x19 submachine gun")).toBe("smg");
    expect(weaponClass("Kalashnikov PKM 7.62x54R machine gun")).toBe("lmg");
    expect(weaponClass("SVDS 7.62x54R sniper rifle")).toBe("sniper");
    expect(weaponClass("MP-133 12ga pump-action shotgun")).toBe("shotgun");
    expect(weaponClass("Colt M4A1 5.56x45 assault rifle")).toBe("rifle");
  });
});

describe("3D scene: placement", () => {
  const { parts, min, max } = buildScene(arBuild, ar);

  it("gives every installed part one shape, keyed by its build path", () => {
    const ids = parts.map((part) => part.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(1 + 14);
    for (const part of parts) {
      if (part.role === "part" && part.id !== "root") expect(part.id).toBe(part.path.join("/"));
    }
    expect(find(parts, "m4-upper/upper-barrel")).toMatchObject({
      itemId: "barrel-14",
      kind: "barrel",
      parentPath: ["m4-upper"],
      slotId: "upper-barrel",
      parentItemId: "upper",
    });
  });

  it("runs the barrel and muzzle devices forward along the bore", () => {
    const upper = find(parts, "m4-upper");
    const barrel = find(parts, "m4-upper/upper-barrel");
    const brake = find(parts, "m4-upper/upper-barrel/barrel-muzzle");
    const can = find(parts, "m4-upper/upper-barrel/barrel-muzzle/brake-muzzle");
    expect(barrel.size[0]).toBeCloseTo(36.83);
    expect(rear(barrel)).toBeLessThan(front(upper));
    expect(front(barrel)).toBeGreaterThan(front(upper));
    expect(barrel.center[1]).toBe(0);
    expect(rear(brake)).toBeCloseTo(front(barrel));
    // The suppressor slides over the brake and reaches past it.
    expect(rear(can)).toBeLessThan(front(brake));
    expect(front(can)).toBeGreaterThan(front(brake));
    expect(can.size[1]).toBeGreaterThan(brake.size[1]);
  });

  it("puts the stock behind the gun, and the grip and magazine below it", () => {
    const body = find(parts, "root");
    const tube = find(parts, "m4-stock");
    const stock = find(parts, "m4-stock/tube-stock");
    expect(front(tube)).toBeLessThanOrEqual(rear(body) + 1);
    expect(rear(stock)).toBeLessThan(rear(tube));
    for (const id of ["m4-grip", "m4-mag"]) {
      const part = find(parts, id);
      expect(part.face).toBe("bottom");
      expect(part.center[1]).toBeLessThan(bottom(body));
    }
    // The magazine sits ahead of the grip, and the grip rakes back.
    expect(find(parts, "m4-mag").center[0]).toBeGreaterThan(find(parts, "m4-grip").center[0]);
    expect(find(parts, "m4-grip").tilt).toBeLessThan(0);
  });

  it("sits optics on top and spreads rails around the handguard", () => {
    const upper = find(parts, "m4-upper");
    const scope = find(parts, "m4-upper/upper-scope");
    expect(scope).toMatchObject({ kind: "optic", shape: "cylinder", face: "top" });
    expect(bottom(scope)).toBeCloseTo(top(upper));

    const guard = find(parts, "m4-upper/upper-guard");
    expect(guard.size[0]).toBeCloseTo(25.4);
    expect(find(parts, "m4-upper/upper-guard/guard-top").face).toBe("top");
    const side = find(parts, "m4-upper/upper-guard/guard-side");
    expect(side.face).toBe("right");
    // A sight on a side rail stands out from that side, not on top.
    const dot = find(parts, "m4-upper/upper-guard/guard-side/side-scope");
    expect(dot).toMatchObject({ kind: "optic", shape: "box", face: "right" });
    expect(dot.center[2]).toBeGreaterThan(side.center[2]);
    expect(find(parts, "m4-upper/upper-guard/guard-light").face).toBe("right");
  });

  it("reports bounds that contain every part", () => {
    for (const part of parts) {
      for (let axis = 0; axis < 3; axis += 1) {
        expect(part.center[axis] - part.size[axis] / 2).toBeGreaterThanOrEqual(min[axis] - 1e-9);
        expect(part.center[axis] + part.size[axis] / 2).toBeLessThanOrEqual(max[axis] + 1e-9);
      }
    }
  });

  it("follows the build when a part is swapped", () => {
    const longer = attachMod(
      arBuild,
      ["m4-upper"],
      "upper-barrel",
      node("barrel-20", arBuild.slots["m4-upper"].slots["upper-barrel"].slots)
    );
    const next = buildScene(longer, ar).parts;
    const barrel = find(next, "m4-upper/upper-barrel");
    const brake = find(next, "m4-upper/upper-barrel/barrel-muzzle");
    expect(barrel.size[0]).toBeCloseTo(50.8);
    expect(rear(brake)).toBeCloseTo(front(barrel));
    expect(rear(brake) - rear(find(parts, "m4-upper/upper-barrel/barrel-muzzle"))).toBeGreaterThan(10);
  });
});

describe("3D scene: empty, built-in, and unknown parts", () => {
  it("outlines required slots with nothing in them, unless asked not to", () => {
    const stripped = node("m4", { "m4-upper": node("upper") });
    const { parts } = buildScene(stripped, ar);
    expect(find(parts, "m4-mag")).toMatchObject({ role: "empty", itemId: null, kind: "magazine" });
    expect(find(parts, "m4-upper/upper-barrel")).toMatchObject({ role: "empty", kind: "barrel" });
    expect(parts.some((part) => part.id === "m4-grip")).toBe(false);
    expect(parts.some((part) => part.id === "m4-upper/upper-scope")).toBe(false);

    const bare = buildScene(stripped, ar, { includeEmptyRequired: false }).parts;
    expect(bare.map((part) => part.id)).toEqual(["root", "m4-upper"]);
  });

  it("draws a built-in barrel for guns whose muzzle mounts straight on the receiver", () => {
    const ak = lookup(
      item("ak", "Test AK 5.45x39 assault rifle", [
        slot("ak-muzzle", "mod_muzzle", ["ak-brake"]),
        slot("ak-gas", "mod_gas_block", ["tube"]),
      ], { isWeapon: true }),
      item("ak-brake", "AK-74 muzzle brake"),
      item("tube", "AK-74 gas tube")
    );
    const { parts } = buildScene(node("ak", { "ak-muzzle": node("ak-brake"), "ak-gas": node("tube") }), ak);
    const barrel = find(parts, "builtin:barrel");
    expect(barrel).toMatchObject({ role: "builtin", itemId: null, kind: "barrel", slot: null });
    expect(rear(find(parts, "ak-muzzle"))).toBeCloseTo(front(barrel));
    // The gas tube runs above the barrel.
    expect(find(parts, "ak-gas").center[1]).toBeGreaterThan(barrel.center[1]);

    // An AR has its barrel slot on the upper, so it gets no built-in barrel.
    expect(buildScene(arBuild, ar).parts.some((part) => part.role === "builtin")).toBe(false);
  });

  it("gives a pistol a frame grip and a slide that covers the bore", () => {
    const glock = lookup(
      item("glock", "Test Glock 9x19 pistol", [
        slot("g-barrel", "mod_barrel", ["g-barrel"], { required: true }),
        slot("g-slide", "mod_reciever", ["slide"], { required: true }),
        slot("g-grip", "mod_pistol_grip", ["backstrap"]),
      ], { isWeapon: true }),
      item("g-barrel", "Glock 9x19 114mm barrel"),
      item("slide", "Glock pistol slide"),
      item("backstrap", "Glock backstrap")
    );
    const build = node("glock", { "g-barrel": node("g-barrel"), "g-slide": node("slide") });
    const { parts } = buildScene(build, glock);
    const slide = find(parts, "g-slide");
    expect(bottom(slide)).toBeLessThan(0);
    expect(top(slide)).toBeGreaterThan(0);
    expect(find(parts, "builtin:grip").role).toBe("builtin");
    // Most of the barrel is inside the slide.
    expect(front(find(parts, "g-barrel")) - front(slide)).toBeLessThan(3);

    const withGrip = buildScene({ ...build, slots: { ...build.slots, "g-grip": node("backstrap") } }, glock).parts;
    expect(withGrip.some((part) => part.id === "builtin:grip")).toBe(false);
  });

  it("still lays out parts whose data has not loaded yet", () => {
    const partial = new Map([["m4", ar.get("m4")!]]);
    const { parts } = buildScene(arBuild, partial);
    expect(find(parts, "m4-upper")).toMatchObject({ kind: "receiver", itemId: "upper" });
    // The upper isn't loaded, so its children are placed without knowing their slot kinds.
    const barrel = find(parts, "m4-upper/upper-barrel");
    expect(barrel).toMatchObject({ kind: "other", slot: null, itemId: "barrel-14" });

    const unknownWeapon = buildScene(node("missing", { a: node("b") }), new Map());
    expect(unknownWeapon.parts.map((part) => part.id)).toEqual(["root", "a"]);
    expect(unknownWeapon.parts.every((part) => part.size.every((value) => value > 0))).toBe(true);
  });
});

describe("3D view setting", () => {
  it("keeps the 3D view and hide-empty settings independent, and accepts views saved before 3D existed", () => {
    window.localStorage.clear();
    window.localStorage.setItem(VIEW_STORE.key, JSON.stringify({ version: 1, data: { hideEmpty: true } }));
    expect(readStore(VIEW_STORE)).toEqual({ hideEmpty: true });
    setShow3d(true);
    setHideEmptySlots(false);
    expect(readStore(VIEW_STORE)).toEqual({ hideEmpty: false, show3d: true });
    expect(VIEW_STORE.validate({ hideEmpty: false, show3d: "yes" })).toBe(false);
  });
});
