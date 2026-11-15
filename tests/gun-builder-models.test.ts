import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildItemData, ModSlotDef } from "@/app/lib/types/gunBuilder";
import {
  buildScene,
  finishFromName,
  partVariant,
  weaponLayout,
  type ScenePart,
  type VariantContext,
  type Vec3,
} from "@/app/lib/builds/build-scene";
import { applyTransform, modelTransform, VARIANT_SPECS, type ModelShape } from "@/app/lib/builds/part-models";
import manifest from "@/app/lib/builds/gun-parts-model.json";

function slot(id: string, nameId: string, allowed: string[], extra: Partial<ModSlotDef> = {}): ModSlotDef {
  return { id, name: id, nameId, required: false, allowedItemIds: allowed, ...extra };
}

function item(id: string, name: string, slots: ModSlotDef[] = [], extra: Partial<BuildItemData> = {}): BuildItemData {
  return {
    id, name, shortName: id, gridImageLink: null, weight: 1, traderPriceRUB: 100, fleaPriceRUB: null,
    ergonomics: 0, recoilModifier: 0, recoilVertical: null, recoilHorizontal: null, isWeapon: false,
    conflictingItemIds: [], conflictingSlotIds: [], slots, ...extra,
  };
}

function scenePart(extra: Partial<ScenePart>): ScenePart {
  return {
    id: "a", kind: "optic", shape: "box", itemId: "x", role: "part", path: ["a"], parentPath: [], slotId: "a",
    slot: null, parentItemId: "gun", center: [0, 0, 0], size: [1, 1, 1], tilt: 0, face: "top",
    variant: "generic", finish: null, ...extra,
  };
}

function corners(min: Vec3, max: Vec3): Vec3[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
}

function extent(points: Vec3[]) {
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  return { min, max };
}

function expectClose(actual: number[], expected: number[]) {
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
}

/** Node names in a GLB file, read from its JSON chunk. */
function glbNodes(path: string) {
  const buffer = readFileSync(path);
  expect(buffer.toString("ascii", 0, 4)).toBe("glTF");
  const length = buffer.readUInt32LE(12);
  expect(buffer.toString("ascii", 16, 20)).toBe("JSON");
  const json = JSON.parse(buffer.toString("utf8", 20, 20 + length)) as {
    nodes: { name?: string; mesh?: number }[];
    extensionsUsed?: string[];
  };
  return { json, size: buffer.length };
}

describe("gun part models: the GLB", () => {
  const { json, size } = glbNodes(join(process.cwd(), "public/models/gun-parts.glb"));

  it("has a model and a mount empty for every variant the app knows, and nothing else", () => {
    const meshes = json.nodes.filter((node) => node.mesh !== undefined).map((node) => node.name).sort();
    expect(meshes).toEqual([...manifest.variants].sort());
    expect(Object.keys(VARIANT_SPECS).sort()).toEqual([...manifest.variants].sort());
    const names = new Set(json.nodes.map((node) => node.name));
    for (const variant of manifest.variants) expect(names.has(`${variant}__mount`)).toBe(true);
  });

  it("is quantized without Draco or meshopt, so three.js needs no decoder", () => {
    expect(json.extensionsUsed ?? []).toContain("KHR_mesh_quantization");
    expect(json.extensionsUsed ?? []).not.toContain("KHR_draco_mesh_compression");
    expect(json.extensionsUsed ?? []).not.toContain("EXT_meshopt_compression");
  });

  it("stays small and is loaded by a versioned URL", () => {
    expect(size).toBeLessThan(500 * 1024);
    expect(manifest.url).toMatch(/^\/models\/gun-parts\.glb\?v=[0-9a-f]{12}$/);
  });
});

describe("gun part models: fitting a model to its part", () => {
  const model: ModelShape = { min: [-3, 0, -1], max: [3, 4, 1], mount: [0, 0, 0] };

  it("stretches a model to fill its part's box exactly, on any side", () => {
    for (const face of ["top", "bottom", "right", "left"] as const) {
      const size: Vec3 = face === "top" || face === "bottom" ? [8, 2, 3] : [8, 3, 2];
      const part = scenePart({ face, center: [5, 1, -2], size });
      const transform = modelTransform(part, { mount: "up", fit: "stretch" }, model);
      const { min, max } = extent(corners(model.min, model.max).map((point) => applyTransform(transform, point)));
      expectClose(min, [1, 1 - size[1] / 2, -2 - size[2] / 2]);
      expectClose(max, [9, 1 + size[1] / 2, -2 + size[2] / 2]);
    }
  });

  it("turns a model built to sit on top so it stands out from the side it faces", () => {
    const part = scenePart({ face: "right", center: [0, 0, 2], size: [6, 2, 4] });
    const transform = modelTransform(part, { mount: "up", fit: "uniform" }, model);
    // The model's top points along +z, and its base sits on the parent's side.
    const base = applyTransform(transform, [0, 0, 0]);
    const tip = applyTransform(transform, [0, 4, 0]);
    expectClose(base, [0, 0, 0]);
    expect(tip[2]).toBeGreaterThan(base[2]);
    expect(Math.abs(tip[1] - base[1])).toBeLessThan(1e-6);
  });

  it("keeps a uniform model's proportions, inside its box and attached at its mount", () => {
    const part = scenePart({ face: "top", center: [0, 3, 0], size: [12, 2, 2] });
    const transform = modelTransform(part, { mount: "up", fit: "uniform" }, { ...model, mount: [1, 0, 0] });
    expect(new Set(transform.scale).size).toBe(1);
    expectClose(applyTransform(transform, [1, 0, 0]), [0, 2, 0]);
    const { min, max } = extent(corners(model.min, model.max).map((point) => applyTransform(transform, point)));
    for (let axis = 0; axis < 3; axis += 1) expect(max[axis] - min[axis]).toBeLessThanOrEqual(part.size[axis] + 1e-6);
  });

  it("runs barrels forward from their rear and stocks back from their front", () => {
    const tube: ModelShape = { min: [0, -1, -1], max: [10, 1, 1], mount: [0, 0, 0] };
    const barrel = modelTransform(scenePart({ kind: "barrel", center: [20, 0, 0], size: [30, 1.6, 1.6] }), VARIANT_SPECS.barrel, tube);
    expectClose(applyTransform(barrel, [0, 0, 0]), [5, 0, 0]);
    expectClose(applyTransform(barrel, [10, 0, 0]), [35, 0, 0]);
    const back: ModelShape = { min: [-10, -1, -1], max: [0, 1, 1], mount: [0, 0, 0] };
    const stock = modelTransform(scenePart({ kind: "stock", center: [-20, -1, 0], size: [20, 8, 3] }), VARIANT_SPECS.stock_fixed, back);
    expectClose(applyTransform(stock, [0, 0, 0]), [-10, -1, 0]);
    expectClose(applyTransform(stock, [-10, 0, 0]), [-30, -1, 0]);
  });

  it("rakes a grip about the point where it meets the gun", () => {
    const grip: ModelShape = { min: [-1.6, -9, -1.4], max: [1.6, 0, 1.4], mount: [0, 0, 0] };
    const part = scenePart({ kind: "grip", face: "bottom", center: [-6, -8, 0], size: [3.2, 9, 2.8], tilt: -0.3 });
    const transform = modelTransform(part, VARIANT_SPECS.grip, grip);
    expectClose(applyTransform(transform, [0, 0, 0]), [-6, -3.5, 0]);
    // A negative tilt swings the bottom of the grip back, toward the stock.
    expect(applyTransform(transform, [0, -9, 0])[0]).toBeLessThan(-6);
  });
});

describe("gun part models: choosing a model", () => {
  const rifle: VariantContext = { cls: "rifle", layout: weaponLayout(""), parentKind: "body" };
  const variant = (kind: ScenePart["kind"], name: string, extra: Partial<VariantContext> = {}, partExtra: Partial<ScenePart> = {}) =>
    partVariant(scenePart({ kind, ...partExtra }), item("x", name), { ...rifle, ...extra });

  it("reads muzzle devices, handguards and stocks from their names", () => {
    expect(variant("muzzle", "Thunder Beast Arms Ultra 5 sound suppressor")).toBe("suppressor");
    expect(variant("muzzle", "AK-74 5.45x39 muzzle brake")).toBe("muzzle_brake");
    expect(variant("muzzle", "SIG Sauer Taper-LOK 7.62x51/.300 BLK muzzle adapter")).toBe("muzzle_adapter");
    expect(variant("muzzle", "AR-15 Colt USGI A2 5.56x45 flash hider")).toBe("muzzle_flash_hider");
    expect(variant("handguard", "AK-74 wooden handguard")).toBe("handguard_classic");
    expect(variant("handguard", "MP-133 beechwood forestock")).toBe("handguard_classic");
    expect(variant("handguard", "AR-15 Daniel Defense RIS II 9.5 handguard")).toBe("handguard_rail");
    expect(variant("handguard", "MCX GEN1 KeyMod 8 inch handguard")).toBe("handguard_mlok");
    expect(variant("stock", "AR-15 Colt Carbine buffer tube")).toBe("buffer_tube");
    expect(variant("stock", "AR-15 Magpul PRS GEN3 stock", { parentKind: "stock" })).toBe("stock_adjustable");
    expect(variant("stock", "AK-74 wooden stock")).toBe("stock_fixed");
    expect(variant("stock", "SIG Sauer Thin Side-Folding Stock")).toBe("stock_skeleton");
  });

  it("matches magazines and receivers to the weapon", () => {
    expect(variant("magazine", "STANAG 30-round magazine")).toBe("mag_curved");
    expect(variant("magazine", "Glock 9x19 17-round magazine", { cls: "pistol" })).toBe("mag_straight");
    expect(variant("magazine", "MP-133 12ga 6-shell magazine", { cls: "shotgun" })).toBe("mag_tube");
    expect(variant("magazine", "FN P90 50-round magazine", { cls: "smg", layout: weaponLayout("FN P90") })).toBe("mag_top");
    expect(partVariant(scenePart({ kind: "magazine" }), item("x", "Test 95-round drum", [], { gridWidth: 2 }), rifle)).toBe("mag_drum");
    expect(variant("receiver", "Glock 17 pistol slide", { cls: "pistol" })).toBe("slide");
    expect(variant("receiver", "AK-74 dust cover")).toBe("dust_cover");
    expect(variant("receiver", "M4A1 upper receiver")).toBe("receiver_upper");
    expect(variant("body", "", { layout: weaponLayout("Steyr AUG A3") })).toBe("body_bullpup");
  });

  it("tells sights and accessories apart", () => {
    expect(partVariant(scenePart({ kind: "optic" }), item("x", "Test 4x scope", [], { gridWidth: 2 }), rifle)).toBe("optic_scope");
    expect(variant("optic", "Test EXPS3 holographic sight")).toBe("optic_holo");
    expect(variant("optic", "Test reflex sight")).toBe("optic_reddot");
    expect(variant("ironSight", "", {}, { slot: slot("s", "mod_sight_front", []) })).toBe("sight_front");
    expect(variant("tactical", "Test PEQ-15 laser aiming module")).toBe("tactical_laser");
    expect(variant("tactical", "Test tactical flashlight")).toBe("tactical_light");
    expect(variant("foregrip", "Test angled foregrip")).toBe("foregrip_angled");
  });

  it("only ever picks models the GLB has", () => {
    const known = new Set(manifest.variants);
    const lookup = new Map(
      [
        item("ak", "Test AK 5.45x39 assault rifle", [slot("m", "mod_muzzle", ["b"]), slot("g", "mod_gas_block", ["t"])], { isWeapon: true }),
        item("b", "AK muzzle brake"),
        item("t", "AK gas tube"),
      ].map((entry) => [entry.id, entry])
    );
    const scene = buildScene({ itemId: "ak", slots: { m: { itemId: "b", slots: {} }, g: { itemId: "t", slots: {} } } }, lookup);
    for (const part of scene.parts) expect(known.has(part.variant)).toBe(true);
    expect(scene.parts.find((part) => part.id === "builtin:barrel")?.variant).toBe("barrel");
    for (const kind of ["body", "receiver", "barrel", "muzzle", "gasBlock", "handguard", "stock", "grip", "magazine", "optic",
      "ironSight", "mount", "tactical", "foregrip", "charge", "launcher", "bipod", "other"] as const) {
      expect(known.has(variant(kind, ""))).toBe(true);
    }
  });

  it("reads finishes from names", () => {
    expect(finishFromName("AK-74 wooden handguard")).toBe("wood");
    expect(finishFromName("MP-133 beechwood forestock")).toBe("wood");
    expect(finishFromName("MDR pistol grip (FDE)")).toBe("tan");
    expect(finishFromName("AR-15 Magpul PRS GEN3 stock (Grey)")).toBe("grey");
    expect(finishFromName("AR-15 Magpul MOE pistol grip (Black)")).toBe("black");
    expect(finishFromName("AR-15 Colt A2 pistol grip")).toBeNull();
  });
});
