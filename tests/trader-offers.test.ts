import { describe, expect, it } from "vitest";
import { barterCost, effectivePrice, offerAllowed, priceChoice, withBarterPrices, withTraderLimits } from "@/app/lib/builds/price";
import { expandCompleted, matchTasks, questChain, type TaskNode } from "@/app/lib/builds/quests";
import { buildShoppingList } from "@/app/lib/builds/shopping";
import type { BarterOffer, BuildItemData, TraderOffer } from "@/app/lib/types/gunBuilder";

const chemical = { id: "chem2", name: "Chemical - Part 2", trader: "Skier", minPlayerLevel: 0 };
const locked: TraderOffer = { trader: "Skier", priceRUB: 100_000, level: 1, taskUnlock: chemical };
const open: TraderOffer = { trader: "Mechanic", priceRUB: 150_000, level: 2 };
const barter: BarterOffer = {
  trader: "Peacekeeper",
  priceRUB: 90_000,
  level: 1,
  requiredItems: [{ name: "Gunpowder", count: 2 }],
  count: 1,
};

function part(extra: Partial<BuildItemData> = {}): BuildItemData {
  return {
    id: "suppressor",
    name: "Suppressor",
    shortName: "Supp",
    gridImageLink: null,
    weight: 0.5,
    traderPriceRUB: 100_000,
    traderName: "Skier",
    traderLevel: 1,
    traderTask: "Chemical - Part 2",
    fleaPriceRUB: null,
    ergonomics: -10,
    recoilModifier: -0.1,
    recoilVertical: null,
    recoilHorizontal: null,
    isWeapon: false,
    conflictingItemIds: [],
    conflictingSlotIds: [],
    slots: [],
    traderOffers: [locked, open],
    barterOffers: [barter],
    barterPriceRUB: 90_000,
    ...extra,
  };
}

describe("quest-locked offers", () => {
  it("are allowed unless excludeQuestLocked is set and their task isn't completed", () => {
    expect(offerAllowed(locked, {})).toBe(true);
    expect(offerAllowed(locked, { excludeQuestLocked: true })).toBe(false);
    expect(offerAllowed(locked, { excludeQuestLocked: true, completedTasks: new Set(["chem2"]) })).toBe(true);
    // Loyalty still applies to an unlocked offer.
    expect(offerAllowed(locked, { excludeQuestLocked: true, completedTasks: new Set(["chem2"]), maxLevel: 0 })).toBe(false);
    expect(offerAllowed(open, { excludeQuestLocked: true })).toBe(true);
  });

  it("move the trader price to the next offer the player can use", () => {
    const item = part();
    expect(withTraderLimits(item, { maxLevel: 4 })).toBe(item);
    expect(withTraderLimits(item, { excludeQuestLocked: true })).toMatchObject({
      traderPriceRUB: 150_000,
      traderName: "Mechanic",
      traderLevel: 2,
      traderTask: null,
    });
    expect(withTraderLimits(item, { excludeQuestLocked: true, maxLevel: 1 })).toMatchObject({
      traderPriceRUB: null,
      traderName: null,
    });
  });
});

describe("barters as a price source", () => {
  it("count only when enabled, and only at levels and tasks the player has", () => {
    const item = part();
    expect(effectivePrice(item, { traders: true, flea: true })).toBe(100_000);
    expect(effectivePrice(item, { traders: true, flea: true, barters: true })).toBe(90_000);
    expect(effectivePrice(item, { traders: false, flea: false, barters: true })).toBe(90_000);
    const lockedBarter = { ...barter, taskUnlock: chemical };
    const sources = { traders: false, flea: false, barters: true };
    const limited = withBarterPrices(part({ barterOffers: [lockedBarter] }), sources, { excludeQuestLocked: true });
    expect(limited.barterPriceRUB).toBeNull();
    expect(effectivePrice(limited, sources)).toBeNull();
  });

  it("cost what their inputs cost the player, from the sources and offers they can use", () => {
    const gunpowder = {
      name: "Gunpowder",
      count: 2,
      traderOffers: [{ trader: "Mechanic", priceRUB: 20_000, level: 2 }],
      fleaPriceRUB: 30_000,
    };
    const trade: BarterOffer = { ...barter, requiredItems: [gunpowder], count: 2 };
    const all = { traders: true, flea: true, barters: true };
    expect(barterCost(trade, all, null)).toBe(20_000);
    expect(barterCost(trade, all, { maxLevel: 1 })).toBe(30_000);
    expect(barterCost(trade, { traders: true, flea: false, barters: true }, { maxLevel: 1 })).toBeNull();
    expect(barterCost({ ...trade, requiredItems: [{ name: "Gunpowder", count: 2 }] }, all, { maxLevel: 1 })).toBe(90_000);

    const repriced = withBarterPrices(part({ barterOffers: [trade, barter] }), { traders: true, flea: false, barters: true }, { maxLevel: 1 });
    expect(repriced.barterOffers?.map((offer) => offer.priceRUB)).toEqual([90_000, null]);
    expect(repriced.barterPriceRUB).toBe(90_000);
  });

  it("say which source and offer a price comes from, preferring cash at equal prices", () => {
    const item = part();
    expect(priceChoice(item, { traders: true, flea: true }, null)).toEqual({
      source: "trader",
      priceRUB: 100_000,
      offer: locked,
    });
    expect(priceChoice(item, { traders: true, flea: true, barters: true }, null)).toEqual({
      source: "barter",
      priceRUB: 90_000,
      offer: barter,
    });
    expect(priceChoice(part({ barterPriceRUB: 100_000, barterOffers: [{ ...barter, priceRUB: 100_000 }] }), { traders: true, flea: false, barters: true }, null)).toMatchObject({ source: "trader" });
    expect(priceChoice(part({ fleaPriceRUB: 80_000 }), { traders: true, flea: true, barters: true }, null)).toEqual({
      source: "flea",
      priceRUB: 80_000,
    });
    expect(priceChoice(part(), { traders: false, flea: true }, null)).toBeNull();
  });

  it("show in the shopping list with the trader and offer they come from", () => {
    const lookup = new Map([["suppressor", part()]]);
    const [row] = buildShoppingList({ itemId: "suppressor", slots: {} }, lookup, { traders: true, flea: true, barters: true }).rows;
    expect(row).toMatchObject({
      source: "barter",
      unitPriceRUB: 90_000,
      offer: barter,
      traderPriceRUB: 100_000,
      traderName: "Skier",
      traderLevel: 1,
      traderTask: "Chemical - Part 2",
    });
    const [cash] = buildShoppingList({ itemId: "suppressor", slots: {} }, lookup, { traders: true, flea: true }).rows;
    expect(cash).toMatchObject({ source: "trader", traderName: "Skier", offer: locked });
  });
});

function task(id: string, requires: TaskNode["requires"] = [], extra: Partial<TaskNode> = {}): TaskNode {
  return {
    id,
    name: id.replace(/-/g, " "),
    normalizedName: id,
    trader: "Skier",
    minPlayerLevel: 1,
    faction: null,
    requires,
    traderLevels: [],
    ...extra,
  };
}

const complete = ["complete"];

describe("quest chains", () => {
  const index = new Map(
    [
      task("start"),
      task("chemical-part-1", [{ id: "start", status: complete }]),
      task("chemical-part-2", [{ id: "chemical-part-1", status: complete }], {
        name: "Chemical - Part 2",
        traderLevels: [{ trader: "Skier", level: 2 }],
      }),
      task("side-branch", [{ id: "start", status: ["active"] }]),
      task("needs-side", [{ id: "side-branch", status: ["active"] }, { id: "start", status: complete }]),
      task("bear-only", [{ id: "start", status: ["failed"] }], { faction: "BEAR", name: "Shared name" }),
      task("usec-only", [], { faction: "USEC", name: "Shared name" }),
      task("loop-a", [{ id: "loop-b", status: complete }]),
      task("loop-b", [{ id: "loop-a", status: complete }]),
    ].map((entry) => [entry.id, entry])
  );

  it("match task ids, names, and slugs ignoring case and punctuation, never typos", () => {
    expect(matchTasks(index, "chemical-part-2")).toEqual(["chemical-part-2"]);
    expect(matchTasks(index, "  chemical PART 2 ")).toEqual(["chemical-part-2"]);
    expect(matchTasks(index, "Chemical - Part 2")).toEqual(["chemical-part-2"]);
    expect(matchTasks(index, "Shared name")).toEqual(["bear-only", "usec-only"]);
    expect(matchTasks(index, "Chemcal - Part 2")).toEqual([]);
  });

  it("count the tasks a completed task needed as completed too", () => {
    expect([...expandCompleted(index, ["chemical-part-2"])].sort()).toEqual(["chemical-part-1", "chemical-part-2", "start"]);
    // A task that only needed another started doesn't prove it complete.
    expect([...expandCompleted(index, ["side-branch"])]).toEqual(["side-branch"]);
  });

  it("list prerequisites first, once each, skipping completed tasks and failure branches", () => {
    const unlocks = new Map([
      ["chemical-part-2", ["Hexagon suppressor"]],
      ["needs-side", ["Rail"]],
      ["bear-only", ["Stock"]],
    ]);
    const chain = questChain(index, unlocks, new Set());
    expect(chain.map((step) => step.task.id)).toEqual([
      "start",
      "chemical-part-1",
      "chemical-part-2",
      "side-branch",
      "needs-side",
      "bear-only",
    ]);
    expect(chain.find((step) => step.task.id === "chemical-part-2")).toMatchObject({ startOnly: false, unlocks: ["Hexagon suppressor"] });
    expect(chain.find((step) => step.task.id === "side-branch")).toMatchObject({ startOnly: true, unlocks: [] });
    expect(chain.find((step) => step.task.id === "start")?.startOnly).toBe(false);

    const done = expandCompleted(index, ["chemical-part-1"]);
    expect(questChain(index, unlocks, done).map((step) => step.task.id)).toEqual([
      "chemical-part-2",
      "side-branch",
      "needs-side",
      "bear-only",
    ]);
  });

  it("survive cycles and tasks tarkov.dev doesn't list", () => {
    const chain = questChain(index, new Map([["loop-a", ["Part"]], ["missing", ["Other"]]]), new Set());
    expect(chain.map((step) => step.task.id)).toEqual(["loop-b", "loop-a"]);
  });
});
