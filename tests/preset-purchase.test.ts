import { describe, expect, it } from "vitest";
import type { BuildItemData, BuildNode, ModSlotDef, PriceSources, TraderOffer } from "@/app/lib/types/gunBuilder";
import { optimizeBuild, type OptimizeOptions } from "@/app/lib/builds/optimizer";
import { planPurchase, presetParts } from "@/app/lib/builds/purchase";
import { buildShoppingList, formatShoppingList } from "@/app/lib/builds/shopping";
import { computeStats } from "@/app/lib/builds/stats";

const TRADERS: PriceSources = { traders: true, flea: false };
const FLEA: PriceSources = { traders: false, flea: true };

function slot(id: string, allowed: string[], extra: Partial<ModSlotDef> = {}): ModSlotDef {
  return { id, name: id, nameId: id, required: false, allowedItemIds: allowed, ...extra };
}

function item(id: string, extra: Partial<BuildItemData> = {}): BuildItemData {
  return {
    id,
    name: id,
    shortName: id,
    gridImageLink: null,
    weight: 0.1,
    traderPriceRUB: null,
    fleaPriceRUB: null,
    ergonomics: 0,
    recoilModifier: 0,
    recoilVertical: null,
    recoilHorizontal: null,
    isWeapon: false,
    conflictingItemIds: [],
    conflictingSlotIds: [],
    slots: [],
    ...extra,
  };
}

function weapon(offers: TraderOffer[], extra: Partial<BuildItemData> = {}) {
  const sorted = offers.toSorted((a, b) => a.priceRUB - b.priceRUB);
  return item("gun", {
    isWeapon: true,
    ergonomics: 40,
    recoilVertical: 100,
    recoilHorizontal: 200,
    defaultPresetId: "gun-default",
    traderOffers: sorted,
    traderPriceRUB: sorted[0]?.priceRUB ?? null,
    traderName: sorted[0]?.trader ?? null,
    traderLevel: sorted[0]?.level ?? null,
    slots: [slot("stock", ["factory-stock", "cheap-stock", "good-stock"], { required: true }), slot("muzzle", ["brake"])],
    ...extra,
  });
}

const parts = [
  item("factory-stock", { traderPriceRUB: 20_000, ergonomics: 5 }),
  item("cheap-stock", { traderPriceRUB: 1_000, ergonomics: 5 }),
  item("good-stock", { traderPriceRUB: 8_000, ergonomics: 15 }),
  item("brake", { traderPriceRUB: 4_000, recoilModifier: -0.05 }),
];

function lookup(gun: BuildItemData) {
  return new Map([gun, ...parts].map((entry) => [entry.id, entry]));
}

const presetOnly = weapon([{ trader: "Prapor", priceRUB: 35_000, level: 1, preset: "Gun Default" }]);
const contents = { baseItemId: "gun", itemIds: ["gun", "factory-stock", "brake"] };
const preset = presetParts("gun", contents, lookup(presetOnly));
const factory: BuildNode = {
  itemId: "gun",
  slots: { stock: { itemId: "factory-stock", slots: {} }, muzzle: { itemId: "brake", slots: {} } },
};

describe("buying a weapon as its default preset", () => {
  it("prices the default preset at the preset's price, not the preset plus its parts again", () => {
    const stats = computeStats(factory, lookup(presetOnly), TRADERS, null, { preset });
    expect(stats.costRUB).toBe(35_000);
    expect(stats.costMissingCount).toBe(0);
    expect(stats.purchase).toMatchObject({ asPreset: true, weapon: { source: "trader", priceRUB: 35_000 } });
    expect(stats.purchase.owned.size).toBe(2);
  });

  it("charges only the new part when a preset part is swapped, keeping the old one with no resale credit", () => {
    const swapped: BuildNode = { itemId: "gun", slots: { ...factory.slots, stock: { itemId: "good-stock", slots: {} } } };
    const plan = planPurchase(swapped, lookup(presetOnly), TRADERS, { preset });
    expect(plan.costRUB).toBe(35_000 + 8_000);
    expect([...plan.spare]).toEqual([["factory-stock", 1]]);
  });

  it("buys the bare weapon when that is cheaper for the build", () => {
    const gun = weapon([
      { trader: "Prapor", priceRUB: 35_000, level: 1, preset: "Gun Default" },
      { trader: "Peacekeeper", priceRUB: 15_000, level: 1 },
    ]);
    const cheap: BuildNode = { itemId: "gun", slots: { stock: { itemId: "cheap-stock", slots: {} } } };
    const plan = planPurchase(cheap, lookup(gun), TRADERS, { preset });
    expect(plan).toMatchObject({ asPreset: false, costRUB: 16_000, weapon: { priceRUB: 15_000 } });
    expect(plan.owned.size).toBe(0);
    expect(planPurchase(factory, lookup(gun), TRADERS, { preset })).toMatchObject({ asPreset: true, costRUB: 35_000 });
  });

  it("treats the flea price of a weapon with a default preset as the preset's price", () => {
    const gun = weapon([], { fleaPriceRUB: 50_000 });
    const data = new Map([gun, ...parts.map((part) => ({ ...part, fleaPriceRUB: part.traderPriceRUB }))].map((entry) => [entry.id, entry]));
    expect(computeStats(factory, data, FLEA, null, { preset })).toMatchObject({
      costRUB: 50_000,
      purchase: { asPreset: true, weapon: { source: "flea" } },
    });
  });

  it("respects trader limits when choosing between the bare weapon and the preset", () => {
    const gun = weapon([
      { trader: "Prapor", priceRUB: 30_000, level: 2, preset: "Gun Default" },
      { trader: "Peacekeeper", priceRUB: 40_000, level: 1 },
    ]);
    const limits = { maxLevel: 1 };
    expect(planPurchase(factory, lookup(gun), TRADERS, { preset })).toMatchObject({ asPreset: true, costRUB: 30_000 });
    expect(planPurchase(factory, lookup(gun), TRADERS, { preset, limits })).toMatchObject({
      asPreset: false,
      costRUB: 40_000 + 20_000 + 4_000,
    });
  });

  it("prices every part when the preset's contents aren't known", () => {
    expect(computeStats(factory, lookup(presetOnly), TRADERS).costRUB).toBe(35_000 + 20_000 + 4_000);
  });

  it("leaves preset parts out of the shopping list's purchases", () => {
    const swapped: BuildNode = { itemId: "gun", slots: { ...factory.slots, stock: { itemId: "good-stock", slots: {} } } };
    const list = buildShoppingList(swapped, lookup(presetOnly), TRADERS, true, { preset });
    expect(list.totalRUB).toBe(43_000);
    expect(list.itemCount).toBe(2);
    expect(list.rows).toEqual([
      expect.objectContaining({ itemId: "gun", count: 1, withWeapon: 0, source: "trader", subtotalRUB: 35_000 }),
      expect.objectContaining({ itemId: "good-stock", count: 1, withWeapon: 0, subtotalRUB: 8_000 }),
      expect.objectContaining({ itemId: "brake", count: 0, withWeapon: 1, source: null, subtotalRUB: 0 }),
    ]);
    const text = formatShoppingList(list, { buildName: "Swap", weaponName: "gun", modeLabel: "PVP" });
    expect(text).toMatch(/Prapor LL1 preset/);
    expect(text).toMatch(/brake.*\+1 with weapon/);
    expect(text).toContain("Total: 43,000 RUB for 2 items");
    expect(buildShoppingList(swapped, lookup(presetOnly), TRADERS, false, { preset }).totalRUB).toBe(12_000);
  });
});

describe("optimising a weapon sold as its default preset", () => {
  const optimize = (gun: BuildItemData, options: Partial<OptimizeOptions>) =>
    optimizeBuild(factory, lookup(gun), { goal: "cost", priceSources: TRADERS, preset, ...options }, { pause: async () => undefined });

  it("keeps the preset's parts free, so the cheapest build is the preset itself", async () => {
    const result = await optimize(presetOnly, {});
    expect(result.root.slots.stock.itemId).toBe("factory-stock");
    expect(result.costRUB).toBe(35_000);
  });

  it("picks the bare weapon or the preset, whichever is cheaper for the build it finds", async () => {
    const gun = weapon([
      { trader: "Prapor", priceRUB: 35_000, level: 1, preset: "Gun Default" },
      { trader: "Peacekeeper", priceRUB: 40_000, level: 1 },
    ]);
    expect(await optimize(gun, {})).toMatchObject({ costRUB: 35_000, root: factory });
    const cheapBare = weapon([
      { trader: "Prapor", priceRUB: 35_000, level: 1, preset: "Gun Default" },
      { trader: "Peacekeeper", priceRUB: 20_000, level: 1 },
    ]);
    const result = await optimize(cheapBare, {});
    expect(result.root.slots.stock.itemId).toBe("cheap-stock");
    expect(result.costRUB).toBe(25_000);
  });

  it("spends a budget on what the preset lacks, with its parts free", async () => {
    const gun = weapon([
      { trader: "Prapor", priceRUB: 35_000, level: 1, preset: "Gun Default" },
      { trader: "Peacekeeper", priceRUB: 40_000, level: 1 },
    ]);
    const result = await optimize(gun, { goal: "ergonomics", budget: 43_000 });
    expect(result.root.slots.stock.itemId).toBe("good-stock");
    expect(result.root.slots.muzzle?.itemId).toBe("brake");
    expect(result).toMatchObject({ costRUB: 43_000, withinBudget: true });
  });

  it("makes a preset part free only once, though it fits several slots", async () => {
    const gun = weapon([{ trader: "Prapor", priceRUB: 35_000, level: 1, preset: "Gun Default" }], {
      slots: [
        slot("stock", ["factory-stock", "cheap-stock"], { required: true }),
        slot("spare-stock", ["factory-stock", "cheap-stock"], { required: true }),
      ],
    });
    const data = lookup(gun);
    const owned = presetParts("gun", { baseItemId: "gun", itemIds: ["gun", "factory-stock"] }, data);
    const root: BuildNode = { itemId: "gun", slots: { stock: { itemId: "factory-stock", slots: {} } } };
    const result = await optimizeBuild(
      root,
      data,
      { goal: "cost", priceSources: TRADERS, preset: owned, budget: 36_000 },
      { pause: async () => undefined }
    );
    expect(result.root.slots).toEqual({
      stock: { itemId: "factory-stock", slots: {} },
      "spare-stock": { itemId: "cheap-stock", slots: {} },
    });
    expect(result).toMatchObject({ costRUB: 36_000, withinBudget: true });

    // One part object in two slots is still two parts, and only one comes with the weapon.
    const shared = { itemId: "factory-stock", slots: {} };
    const twice: BuildNode = { itemId: "gun", slots: { stock: shared, "spare-stock": shared } };
    expect(planPurchase(twice, data, TRADERS, { preset: owned })).toMatchObject({ costRUB: 55_000 });
    const list = buildShoppingList(twice, data, TRADERS, true, { preset: owned });
    expect(list.totalRUB).toBe(55_000);
    expect(list.rows[1]).toMatchObject({ itemId: "factory-stock", count: 1, withWeapon: 1 });
  });
});
