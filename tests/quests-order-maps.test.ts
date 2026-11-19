import { describe, expect, it } from "vitest";
import { ANY_MAP, ANY_MAP_FROM, mapLabels } from "@/app/lib/quests/display";
import { orderQuests, orderTraders, TRADER_ORDER } from "@/app/lib/quests/order";
import type { QuestMap } from "@/app/lib/quests/types";

const map = (key: string, name: string, page: string | null = key): QuestMap => ({ key, name, page });
const MAPS: Record<string, QuestMap> = Object.fromEntries(
  [
    map("customs", "Customs"),
    map("factory", "Factory"),
    map("night-factory", "Night Factory", "factory"),
    map("infected-factory", "Infected Factory", "factory"),
    map("ground-zero", "Ground Zero"),
    map("ground-zero-21", "Ground Zero 21+", "ground-zero"),
    map("ground-zero-tutorial", "Ground Zero Tutorial", "ground-zero"),
    map("the-lab", "The Lab"),
    map("the-lab-dark", "The Lab (Dark)", "the-lab"),
    map("infected-lab", "Infected Lab", "the-lab"),
    map("woods", "Woods"),
    map("shoreline", "Shoreline"),
    map("interchange", "Interchange"),
    map("reserve", "Reserve"),
    map("lighthouse", "Lighthouse"),
    map("streets-of-tarkov", "Streets of Tarkov"),
    map("icebreaker", "Icebreaker", null),
  ].map((entry) => [entry.key, entry])
);

describe("map labels", () => {
  it("merges variants into the map whose page they share, keeping the first-named order", () => {
    expect(mapLabels(["night-factory", "customs", "factory", "infected-factory"], MAPS)).toEqual(["Factory", "Customs"]);
    expect(mapLabels(["ground-zero-tutorial", "ground-zero-21", "ground-zero"], MAPS)).toEqual(["Ground Zero"]);
    expect(mapLabels(["the-lab-dark", "infected-lab"], MAPS)).toEqual(["The Lab"]);
  });

  it("names a variant after its base map even when the list doesn't carry the base map", () => {
    const onlyVariant = { "night-factory": MAPS["night-factory"] };
    expect(mapLabels(["night-factory"], onlyVariant)).toEqual(["Night Factory"]);
    expect(mapLabels(["night-factory"], { ...onlyVariant, factory: MAPS.factory })).toEqual(["Factory"]);
  });

  it("keeps maps without a page, and unknown keys, as they are", () => {
    expect(mapLabels(["icebreaker", "mystery"], MAPS)).toEqual(["Icebreaker", "mystery"]);
    expect(mapLabels([], MAPS)).toEqual([]);
  });

  it(`says "${ANY_MAP}" from ${ANY_MAP_FROM} maps once variants merge`, () => {
    // Thirteen keys, but seven maps: listed.
    const seven = [
      "customs",
      "factory",
      "night-factory",
      "infected-factory",
      "ground-zero",
      "ground-zero-21",
      "ground-zero-tutorial",
      "the-lab",
      "the-lab-dark",
      "infected-lab",
      "woods",
      "shoreline",
      "interchange",
    ];
    expect(mapLabels(seven, MAPS)).toEqual(["Customs", "Factory", "Ground Zero", "The Lab", "Woods", "Shoreline", "Interchange"]);
    expect(mapLabels([...seven, "reserve"], MAPS)).toEqual([ANY_MAP]);
    expect(mapLabels(Object.keys(MAPS), MAPS)).toEqual([ANY_MAP]);
  });
});

describe("trader order", () => {
  it("follows the game's order, with traders it doesn't know after, as given", () => {
    expect(orderTraders(["BTR Driver", "Jaeger", "Taran", "Prapor", "Ref", "Lightkeeper", "Fence", "Skier", "Mr. Kerman", "Therapist"])).toEqual([
      "Prapor",
      "Therapist",
      "Fence",
      "Skier",
      "Jaeger",
      "Ref",
      "Lightkeeper",
      "BTR Driver",
      "Taran",
      "Mr. Kerman",
    ]);
    expect(orderTraders([...TRADER_ORDER].reverse())).toEqual([...TRADER_ORDER]);
  });
});

describe("quest order", () => {
  const quest = (id: string, trader: string | null, minPlayerLevel: number, requires: string[] = [], name = id) => ({
    id,
    name,
    trader,
    minPlayerLevel,
    requires: requires.map((other) => ({ id: other, status: ["complete" as const] })),
  });
  const ids = (quests: { id: string }[]) => quests.map((entry) => entry.id);
  const traders = orderTraders(["BTR Driver", "Mechanic", "Prapor", "Therapist", "Taran"]);

  it("groups by trader in the game's order, quests with no trader last", () => {
    const quests = [
      quest("btr", "BTR Driver", 1),
      quest("none", null, 1),
      quest("mech", "Mechanic", 1),
      quest("taran", "Taran", 1),
      quest("ther", "Therapist", 1),
      quest("prapor", "Prapor", 1),
    ];
    expect(ids(orderQuests(quests, traders))).toEqual(["prapor", "ther", "mech", "btr", "taran", "none"]);
  });

  it("orders a trader's quests by level, then age, but always after the same trader's quests they need", () => {
    // Ids as the game makes them: they start with the time, so they sort oldest first.
    const quests = [
      quest("5936da9e86f7742d65037edf", "Prapor", 0, [], "Background Check"),
      quest("5936d90786f7742b1420ba5b", "Prapor", 0, [], "Debut"),
      // Level 1 is open from the start too: no later than level 0.
      quest("657315df034d76585f032e01", "Prapor", 1, [], "Shooting Cans"),
      quest("59674eb386f774539f14813a", "Prapor", 1, [], "Delivery From the Past"),
      // Old and low level, but it needs Shooting Cans first.
      quest("59000000000000000000000a", "Prapor", 0, ["657315df034d76585f032e01"], "Aaa After Cans"),
      quest("597a171586f77405ba6887d3", "Prapor", 9, [], "Big Customer"),
      // Needs another trader's quest: that doesn't hold it back here.
      quest("5ac0000000000000000000cc", "Prapor", 3, ["ther"], "Cross"),
      quest("ther", "Therapist", 20, [], "Shortage"),
    ];
    expect(orderQuests(quests, traders).map((entry) => entry.name)).toEqual([
      "Debut",
      "Background Check",
      "Delivery From the Past",
      "Shooting Cans",
      "Aaa After Cans",
      "Cross",
      "Big Customer",
      "Shortage",
    ]);
  });

  it("still places every quest when the data has a cycle", () => {
    const quests = [quest("a", "Prapor", 1, ["b"]), quest("b", "Prapor", 2, ["a"]), quest("c", "Prapor", 3)];
    // c is ready first; then the cycle is broken at the lowest level.
    expect(ids(orderQuests(quests, traders))).toEqual(["c", "a", "b"]);
  });
});
