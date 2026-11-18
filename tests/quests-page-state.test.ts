import { describe, expect, it } from "vitest";
import { chainEdgeKind, layoutChain, CHAIN_NODE } from "@/app/lib/quests/chain-layout";
import { questGraph, traderChain } from "@/app/lib/quests/graph";
import {
  DEFAULT_QUEST_PAGE_STATE,
  activeFilterCount,
  clearedFilters,
  parseQuestPageState,
  questFilter,
  questPageSearch,
} from "@/app/lib/quests/page-state";
import { CURRENCY_ITEMS, shoppingList } from "@/app/lib/quests/shopping-list";
import type { QuestSummary } from "@/app/lib/quests/types";

function quest(id: string, overrides: Partial<QuestSummary> = {}): QuestSummary {
  return {
    id,
    name: id.toUpperCase(),
    slug: id,
    trader: "Prapor",
    minPlayerLevel: 1,
    faction: null,
    kappaRequired: false,
    lightkeeperRequired: false,
    maps: [],
    requires: [],
    traderLevels: [],
    failedBy: [],
    prestige: null,
    experience: 0,
    needs: [],
    keys: [],
    objectives: [],
    optionalObjectives: [],
    image: null,
    ...overrides,
  };
}

describe("quests page URL state", () => {
  it("reads every option from the query string", () => {
    const state = parseQuestPageState(
      new URLSearchParams("view=items&q=gas+an&trader=Therapist&map=factory&min=5&max=20&kappa=1&lk=1&fir=1&status=locked,available&own=1&scope=available&layout=steps")
    );
    expect(state).toEqual({
      view: "items",
      text: "gas an",
      trader: "Therapist",
      map: "factory",
      minLevel: 5,
      maxLevel: 20,
      kappa: true,
      lightkeeper: true,
      fir: true,
      states: ["available", "locked"],
      ownFaction: true,
      scope: "available",
      layout: "steps",
    });
  });

  it("falls back to the default for anything unknown or malformed", () => {
    expect(
      parseQuestPageState({ view: "admin", map: "../etc", min: "0", max: "1e3", kappa: "true", status: "done", scope: "all", layout: ["steps", "tree"] })
    ).toEqual({ ...DEFAULT_QUEST_PAGE_STATE, layout: "steps" });
    expect(parseQuestPageState({ trader: "x".repeat(61), q: "y".repeat(200) })).toMatchObject({ trader: null, text: "y".repeat(100) });
  });

  it("writes only what differs from the default, and reads back the same state", () => {
    expect(questPageSearch(DEFAULT_QUEST_PAGE_STATE)).toBe("");
    const state = { ...DEFAULT_QUEST_PAGE_STATE, view: "chains" as const, trader: "Mechanic", states: ["failed" as const, "available" as const] };
    const search = questPageSearch(state);
    expect(search).toBe("?view=chains&trader=Mechanic&status=available%2Cfailed");
    expect(parseQuestPageState(new URLSearchParams(search))).toEqual({ ...state, states: ["available", "failed"] });
  });

  it("applies status and faction filters only once progress has loaded", () => {
    const state = { ...DEFAULT_QUEST_PAGE_STATE, states: ["available" as const], ownFaction: true, kappa: true };
    expect(questFilter(state, false)).toMatchObject({ kappa: true, states: undefined, ownFaction: false });
    expect(questFilter(state, true)).toMatchObject({ states: ["available"], ownFaction: true });
  });

  it("counts and clears filters but keeps the view", () => {
    const state = { ...DEFAULT_QUEST_PAGE_STATE, view: "items" as const, scope: "available" as const, text: "salewa", minLevel: 3, maxLevel: 9, fir: true };
    expect(activeFilterCount(state)).toBe(2);
    expect(clearedFilters(state)).toEqual({ ...DEFAULT_QUEST_PAGE_STATE, view: "items", scope: "available" });
  });
});

describe("quest chain layout", () => {
  const quests = [
    quest("a"),
    quest("b", { minPlayerLevel: 2 }),
    quest("c", { requires: [{ id: "b", status: ["complete"] }] }),
    quest("d", { requires: [{ id: "a", status: ["active"] }] }),
    quest("e", { requires: [{ id: "c", status: ["failed"] }, { id: "s", status: ["complete"] }] }),
    quest("s", { trader: "Skier" }),
    quest("t", { trader: "Skier", requires: [{ id: "d", status: ["complete"] }] }),
  ];
  const graph = questGraph(quests);
  const layout = layoutChain(graph, traderChain(graph, "Prapor"));

  it("orders a column by where its prerequisites sit", () => {
    // c and d share a level; c follows b (row 1), d follows a (row 0), so d goes first.
    expect(layout.columns).toEqual([["a", "b"], ["d", "c"], ["e"]]);
    expect(layout.nodes.find((node) => node.id === "c")).toMatchObject({
      column: 1,
      row: 1,
      x: CHAIN_NODE.width + CHAIN_NODE.columnGap,
      y: CHAIN_NODE.height + CHAIN_NODE.rowGap,
    });
    expect(layout.width).toBe(3 * CHAIN_NODE.width + 2 * CHAIN_NODE.columnGap);
    expect(layout.height).toBe(2 * CHAIN_NODE.height + CHAIN_NODE.rowGap);
  });

  it("draws the trader's own edges by kind and notes other traders' quests", () => {
    expect(layout.paths.map((path) => [path.from, path.to, path.kind])).toEqual([
      ["b", "c", "complete"],
      ["a", "d", "active"],
      ["c", "e", "failed"],
    ]);
    expect(layout.paths[0].d).toMatch(/^M188 79C/);
    expect(layout.external.get("e")).toEqual({ needs: ["s"], unlocks: [] });
    expect(layout.external.get("d")).toEqual({ needs: [], unlocks: ["t"] });
  });

  it("tells a failure branch from a requirement any status meets", () => {
    expect(chainEdgeKind(["failed"])).toBe("failed");
    expect(chainEdgeKind(["complete", "failed"])).toBe("complete");
    expect(chainEdgeKind(["active"])).toBe("active");
  });
});

describe("quest shopping list", () => {
  const roubles = Object.keys(CURRENCY_ITEMS)[0];

  it("splits found-in-raid items from the rest and sets money apart", () => {
    const list = shoppingList({
      items: [
        { id: "salewa", foundInRaid: 3, other: 1, quests: [{ id: "a", count: 3, foundInRaid: true }, { id: "b", count: 1, foundInRaid: false }] },
        { id: roubles, foundInRaid: 0, other: 50_000, quests: [{ id: "c", count: 50_000, foundInRaid: false }] },
        { id: "bolts", foundInRaid: 0, other: 4, quests: [{ id: "a", count: 4, foundInRaid: false }] },
      ],
      choices: [],
      factionVersions: true,
    });
    expect(list.foundInRaid).toEqual([{ id: "salewa", count: 3, quests: [{ id: "a", count: 3 }] }]);
    expect(list.other).toEqual([
      { id: "bolts", count: 4, quests: [{ id: "a", count: 4 }] },
      { id: "salewa", count: 1, quests: [{ id: "b", count: 1 }] },
    ]);
    expect(list.money).toEqual([{ id: roubles, count: 50_000, quests: [{ id: "c", count: 50_000 }] }]);
    expect(list.factionVersions).toBe(true);
  });
});
