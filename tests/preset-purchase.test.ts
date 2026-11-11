import { describe, expect, it } from "vitest";
import type { BuildItemData, BuildNode, ModSlotDef, PriceSources, TraderOffer } from "@/app/lib/types/gunBuilder";
import { optimizeBuild, type OptimizeOptions } from "@/app/lib/builds/optimizer";
import { planPurchase, presetParts } from "@/app/lib/builds/purchase";
import { buildShoppingList, formatShoppingList } from "@/app/lib/builds/shopping";
import { computeStats } from "@/app/lib/builds/stats";

// A weapon bought as its default preset comes with the preset's parts, so a build pays for the
// preset and only the parts it lacks.

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

/** A weapon sold by traders as offers, cheapest first; traderPriceRUB is the cheapest, as the adapter sets it. */
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

const preset = presetParts("gun", { baseItemId: "gun", itemIds: ["gun", "factory-stock", "brake"] });
const factory: BuildNode = {
  itemId: "gun",
  slots: { stock: { itemId: "factory-stock", slots: {} }, muzzle: { itemId: "brake", slots: {} } },
};
const presetOnly = weapon([{ trader: "Prapor", priceRUB: 35_000, level: 1, preset: "Gun Default" }]);

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
    // The factory build is cheaper as the preset (35,000) than bare (15,000 + 20,000 + 4,000).
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
    // Without the weapon, nothing comes with it.
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
    // Bare: 40,000 + 1,000 cheapest stock. As the preset: 35,000 with its own stock.
    expect(await optimize(gun, {})).toMatchObject({ costRUB: 35_000, root: factory });
    const cheapBare = weapon([
      { trader: "Prapor", priceRUB: 35_000, level: 1, preset: "Gun Default" },
      { trader: "Peacekeeper", priceRUB: 20_000, level: 1 },
    ]);
    // Bare: 20,000 + 1,000 cheapest stock + 4,000 for the brake it keeps, under the preset's 35,000.
    const result = await optimize(cheapBare, {});
    expect(result.root.slots.stock.itemId).toBe("cheap-stock");
    expect(result.costRUB).toBe(25_000);
  });

  it("spends a budget on what the preset lacks, with its parts free", async () => {
    // As the preset, the better stock costs 8,000 on top; bare, it would cost 40,000 + 8,000.
    const gun = weapon([
      { trader: "Prapor", priceRUB: 35_000, level: 1, preset: "Gun Default" },
      { trader: "Peacekeeper", priceRUB: 40_000, level: 1 },
    ]);
    const result = await optimize(gun, { goal: "ergonomics", budget: 43_000 });
    expect(result.root.slots.stock.itemId).toBe("good-stock");
    expect(result.root.slots.muzzle?.itemId).toBe("brake");
    expect(result).toMatchObject({ costRUB: 43_000, withinBudget: true });
  });
});
