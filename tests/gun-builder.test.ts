import { beforeEach, describe, expect, it } from "vitest";
import type { BuildItemData, BuildNode, ModSlotDef } from "@/app/lib/types/gunBuilder";
import { reconstructPresetTree } from "@/app/lib/builds/presets";
import {
  attachMod,
  carryOverChildren,
  childAt,
  collectItemIds,
  isBuildTree,
  nodeAt,
  removeMod,
} from "@/app/lib/builds/tree";
import { computeStats } from "@/app/lib/builds/stats";
import { effectivePrice } from "@/app/lib/builds/price";
import { layoutBuild } from "@/app/lib/builds/tree-layout";
import { createBuild, duplicateBuild, renameBuild, updateBuildTree } from "@/app/lib/builds/store";
import { readStore } from "@/app/lib/storage/versioned-store";
import { encodeSharePayload } from "@/app/lib/share-codec";
import { decodeBuildSharePayload, encodeBuildSharePayload } from "@/app/lib/builds/share";

function slot(id: string, allowed: string[], extra: Partial<ModSlotDef> = {}): ModSlotDef {
  return { id, name: id, nameId: id, required: false, allowedItemIds: allowed, ...extra };
}

function item(id: string, slots: ModSlotDef[] = [], extra: Partial<BuildItemData> = {}): BuildItemData {
  return {
    id,
    name: id,
    shortName: id,
    gridImageLink: null,
    weight: 1,
    traderPriceRUB: 100,
    fleaPriceRUB: null,
    ergonomics: 1,
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

describe("preset reconstruction", () => {
  it("places every part even when a greedy placement would block a later one", () => {
    const data = lookup(
      item("gun", [slot("gun-top", ["mount", "sight"]), slot("gun-hg", ["handguard"])], { isWeapon: true }),
      item("handguard", [slot("hg-rail", ["mount"])]),
      item("mount", [slot("mount-top", ["sight"])]),
      item("sight")
    );
    const tree = reconstructPresetTree(
      "gun",
      { baseItemId: "gun", itemIds: ["gun", "mount", "sight", "handguard"] },
      data
    );
    expect(collectItemIds(tree).sort()).toEqual(["gun", "handguard", "mount", "sight"]);
  });

  it("places duplicate parts into separate slots", () => {
    const data = lookup(
      item("gun", [slot("a", ["panel"]), slot("b", ["panel"])], { isWeapon: true }),
      item("panel")
    );
    const tree = reconstructPresetTree("gun", { baseItemId: "gun", itemIds: ["panel", "panel"] }, data);
    expect(Object.keys(tree.slots).sort()).toEqual(["a", "b"]);
  });

  it("skips contents that do not fit any slot", () => {
    const data = lookup(item("gun", [slot("mag", ["magazine"])]), item("magazine"));
    const tree = reconstructPresetTree("gun", { baseItemId: null, itemIds: ["magazine", "ammo"] }, data);
    expect(collectItemIds(tree)).toEqual(["gun", "magazine"]);
  });
});

describe("build tree operations", () => {
  const root: BuildNode = {
    itemId: "gun",
    slots: { hg: { itemId: "handguard", slots: { rail: { itemId: "grip", slots: {} } } } },
  };

  it("ignores inherited keys when reading slots", () => {
    expect(childAt(root, "constructor")).toBeUndefined();
    expect(childAt(root, "__proto__")).toBeUndefined();
    expect(nodeAt(root, ["toString"])).toBeUndefined();
  });

  it("attaches and removes without mutating the original tree", () => {
    const attached = attachMod(root, ["hg"], "top", { itemId: "sight", slots: {} });
    expect(collectItemIds(attached)).toContain("sight");
    expect(collectItemIds(root)).not.toContain("sight");
    const removed = removeMod(attached, ["hg", "rail"]);
    expect(collectItemIds(removed).sort()).toEqual(["gun", "handguard", "sight"]);
  });

  it("carries compatible children over to a replacement part", () => {
    const previous = item("handguard", [slot("old-rail", ["grip"], { nameId: "mod_foregrip" })]);
    const next = item("handguard-2", [
      slot("new-top", ["sight"], { nameId: "mod_scope" }),
      slot("new-rail", ["grip"], { nameId: "mod_foregrip" }),
    ]);
    const swapped = carryOverChildren(
      { itemId: "handguard", slots: { "old-rail": { itemId: "grip", slots: {} } } },
      previous,
      next
    );
    expect(swapped).toEqual({ itemId: "handguard-2", slots: { "new-rail": { itemId: "grip", slots: {} } } });
  });

  it("rejects ids outside the safe character set", () => {
    const ownProto = JSON.parse('{"itemId":"gun","slots":{"__proto__":{"itemId":"x","slots":{}}}}');
    expect(isBuildTree(ownProto)).toBe(true);
    expect(childAt(ownProto, "__proto__")).toEqual({ itemId: "x", slots: {} });
    expect(isBuildTree({ itemId: "gun<script>", slots: {} })).toBe(false);
    expect(isBuildTree({ itemId: "gun", slots: { "a b": { itemId: "x", slots: {} } } })).toBe(false);
  });
});

describe("stats", () => {
  const data = lookup(
    item("gun", [slot("muzzle", ["brake"], { required: true }), slot("stock", ["stock"])], {
      isWeapon: true,
      ergonomics: 50,
      recoilVertical: 100,
      recoilHorizontal: 200,
      weight: 3,
      traderPriceRUB: 1000,
    }),
    item("brake", [], { ergonomics: -2, recoilModifier: -0.1, fleaPriceRUB: 50 }),
    item("stock", [], { ergonomics: 10, recoilModifier: -0.2, traderPriceRUB: null })
  );

  it("sums ergonomics, scales recoil and reports deltas", () => {
    const root: BuildNode = {
      itemId: "gun",
      slots: { muzzle: { itemId: "brake", slots: {} }, stock: { itemId: "stock", slots: {} } },
    };
    const stats = computeStats(root, data, { traders: true, flea: true });
    expect(stats.ergonomics).toBe(58);
    expect(stats.recoilVertical).toBeCloseTo(70);
    expect(stats.recoilHorizontal).toBeCloseTo(140);
    expect(stats.weight).toBe(5);
    expect(stats.costRUB).toBe(1050);
    expect(stats.costMissingCount).toBe(1);
    expect(stats.partCount).toBe(2);
    expect(stats.base?.ergonomics).toBe(50);
    expect(stats.missingRequired).toEqual([]);
  });

  it("lists empty required slots with their location", () => {
    const stats = computeStats({ itemId: "gun", slots: {} }, data, { traders: true, flea: false });
    expect(stats.missingRequired.map((entry) => entry.slot.id)).toEqual(["muzzle"]);
    expect(stats.missingRequired[0].parentPath).toEqual([]);
  });

  it("treats zero or negative prices as unavailable", () => {
    expect(effectivePrice({ traderPriceRUB: 0, fleaPriceRUB: 500 }, { traders: true, flea: true })).toBe(500);
    expect(effectivePrice({ traderPriceRUB: -5, fleaPriceRUB: null }, { traders: true, flea: true })).toBeNull();
  });

  it("marks parts in unknown or disallowed slots as incompatible", () => {
    const root: BuildNode = {
      itemId: "gun",
      slots: { muzzle: { itemId: "stock", slots: {} }, ghost: { itemId: "brake", slots: {} } },
    };
    const nodes = layoutBuild(root, data).nodes.filter((node) => node.kind === "item");
    expect(nodes.map((node) => [node.slotId, node.incompatible])).toEqual([
      ["muzzle", true],
      ["ghost", true],
    ]);
  });
});

describe("build store", () => {
  beforeEach(() => localStorage.clear());

  it("validates names and updates against the latest stored build", () => {
    expect(() => createBuild("   ", "gun")).toThrow(/enter a build name/i);
    const build = createBuild("  My build ", "gun");
    expect(build.name).toBe("My build");
    updateBuildTree(build.id, (root) => attachMod(root, [], "a", { itemId: "x", slots: {} }));
    updateBuildTree(build.id, (root) => attachMod(root, [], "b", { itemId: "y", slots: {} }));
    renameBuild(build.id, "Renamed");
    const stored = readStore({
      key: "eft-toolset:gun-builds",
      version: 1,
      defaultValue: () => [],
      validate: (value): value is { name: string; root: BuildNode }[] => Array.isArray(value),
    })[0];
    expect(stored.name).toBe("Renamed");
    expect(Object.keys(stored.root.slots).sort()).toEqual(["a", "b"]);
    expect(duplicateBuild(build.id).name).toBe("Renamed copy");
  });

  it("ignores a starting tree whose root is a different weapon", () => {
    const build = createBuild("Build", "gun", { itemId: "other", slots: { a: { itemId: "x", slots: {} } } });
    expect(build.root).toEqual({ itemId: "gun", slots: {} });
  });
});

describe("build share links", () => {
  it("round-trips a build", async () => {
    const root: BuildNode = { itemId: "gun", slots: { a: { itemId: "x", slots: { b: { itemId: "y", slots: {} } } } } };
    const payload = await encodeBuildSharePayload({
      id: "id",
      name: "Shared",
      weaponId: "gun",
      root,
      createdAt: 0,
      updatedAt: 0,
    });
    await expect(decodeBuildSharePayload(payload)).resolves.toEqual({ name: "Shared", weaponId: "gun", root });
  });

  it("rejects identifiers with unexpected characters", async () => {
    const payload = await encodeSharePayload({ v: 1, w: "gun", r: ["gun", [["a/b", ["x"]]]] });
    await expect(decodeBuildSharePayload(payload)).rejects.toThrow(/tree is invalid/i);
  });
});
