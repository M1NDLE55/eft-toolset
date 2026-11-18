import { describe, expect, it } from "vitest";
import { completedDependents, questStates, withPrerequisites } from "@/app/lib/quests/availability";
import { filterQuests } from "@/app/lib/quests/filters";
import { chainAfter, chainBefore, questGraph, traderChain } from "@/app/lib/quests/graph";
import { itemsNeeded } from "@/app/lib/quests/items-needed";
import type { QuestList, QuestProgress, QuestSummary } from "@/app/lib/quests/types";

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
    experience: 0,
    needs: [],
    keys: [],
    objectives: [`${id}-1`],
    optionalObjectives: [],
    image: null,
    ...overrides,
  };
}

const QUESTS: QuestSummary[] = [
  quest("a", {
    maps: ["night-factory"],
    kappaRequired: true,
    objectives: ["a-find", "a-give", "a-plant"],
    needs: [
      { objectives: ["a-give", "a-find"], items: ["salewa"], count: 2, foundInRaid: true },
      { objectives: ["a-plant"], items: ["salewa"], count: 1, foundInRaid: false },
      { objectives: ["a-meds"], items: ["salewa", "ifak"], count: 3, foundInRaid: true, label: "Any meds", alternatives: 2 },
    ],
  }),
  quest("b", { minPlayerLevel: 5, requires: [{ id: "a", status: ["complete"] }] }),
  quest("c", { trader: "Therapist", requires: [{ id: "a", status: ["active"] }] }),
  quest("d", { minPlayerLevel: 8, requires: [{ id: "b", status: ["complete"] }], failedBy: [{ id: "e", status: ["complete"] }] }),
  quest("e", { minPlayerLevel: 8, requires: [{ id: "b", status: ["complete"] }], failedBy: [{ id: "d", status: ["complete"] }] }),
  quest("f", { trader: "Skier", requires: [{ id: "d", status: ["failed"] }] }),
  quest("h", { minPlayerLevel: 10, requires: [{ id: "d", status: ["complete", "failed"] }, { id: "elsewhere", status: ["complete"] }] }),
  quest("g", {
    faction: "USEC",
    trader: "Skier",
    needs: [{ objectives: ["g-1"], items: ["salewa"], count: 1, foundInRaid: true }],
  }),
  quest("y", { trader: "Fence", requires: [{ id: "z", status: ["complete"] }] }),
  quest("z", { trader: "Fence", requires: [{ id: "y", status: ["complete"] }] }),
];

const LIST: QuestList = {
  quests: QUESTS,
  items: {
    salewa: { name: "Salewa first aid kit", shortName: "Salewa", slug: "salewa", image: null },
    ifak: { name: "IFAK", shortName: "IFAK", slug: "ifak", image: null },
  },
  maps: {
    "night-factory": { key: "night-factory", name: "Night Factory", page: "factory" },
  },
  traders: ["Prapor", "Therapist", "Fence", "Skier"],
};

const graph = questGraph(QUESTS);
const progress = (overrides: Partial<QuestProgress> = {}): QuestProgress => ({
  completed: [],
  objectives: [],
  level: null,
  faction: null,
  ...overrides,
});

describe("quest availability", () => {
  it("unlocks quests whose requirements are met, counting a quest that can be taken now as started", () => {
    const states = questStates(graph, progress());
    expect(states.get("a")!.state).toBe("available");
    expect(states.get("b")).toEqual({ state: "locked", missing: [{ id: "a", status: ["complete"] }], level: null, otherFaction: false });
    expect(states.get("c")!.state).toBe("available");
    expect(states.get("g")!.state).toBe("available");
  });

  it("checks the level and faction only once they are set", () => {
    const states = questStates(graph, progress({ completed: ["a"], level: 3, faction: "BEAR" }));
    expect(states.get("a")!.state).toBe("completed");
    expect(states.get("b")).toMatchObject({ state: "locked", missing: [], level: 5 });
    expect(states.get("g")).toMatchObject({ state: "locked", otherFaction: true });
  });

  it("fails the other branch of a choice and unlocks what follows a failure", () => {
    const states = questStates(graph, progress({ completed: ["a", "b", "e"] }));
    expect(states.get("d")!.state).toBe("failed");
    expect(states.get("f")!.state).toBe("available");
    // Complete or failed, and a requirement on a quest the list doesn't have is ignored.
    expect(states.get("h")!.state).toBe("available");
  });

  it("treats a done objective as having started the quest, and survives requirement cycles", () => {
    const fresh = questGraph([quest("p", { minPlayerLevel: 50 }), quest("q", { requires: [{ id: "p", status: ["active"] }] })]);
    expect(questStates(fresh, progress({ level: 10 })).get("q")!.state).toBe("locked");
    expect(questStates(fresh, progress({ level: 10, objectives: ["p-1"] })).get("q")!.state).toBe("available");
    const states = questStates(graph, progress());
    expect(states.get("y")!.state).toBe("locked");
    expect(states.get("z")!.state).toBe("locked");
  });

  it("completes strict prerequisites with a quest, and finds completed quests that depend on one", () => {
    expect(withPrerequisites(graph, "d").toSorted()).toEqual(["a", "b", "d"]);
    // h needs d complete or failed, so d is left alone.
    expect(withPrerequisites(graph, "h")).toEqual(["h"]);
    expect(withPrerequisites(graph, "unknown")).toEqual([]);
    expect(completedDependents(graph, "a", ["a", "b", "d", "c"]).toSorted()).toEqual(["b", "d"]);
    expect(completedDependents(graph, "a", ["a"])).toEqual([]);
  });
});

describe("quest chains", () => {
  it("walks prerequisites first and followers nearest first, skipping failure branches", () => {
    expect(chainBefore(graph, "d")).toEqual(["a", "b"]);
    expect(chainBefore(graph, "y")).toEqual(["z"]);
    const after = chainAfter(graph, "a");
    expect(after.slice(0, 2).toSorted()).toEqual(["b", "c"]);
    expect(after.toSorted()).toEqual(["b", "c", "d", "e", "h"]);
    expect(after).not.toContain("f");
  });

  it("lays a trader's quests out in columns by depth, with edges to other traders", () => {
    const chain = traderChain(graph, "Prapor");
    expect(chain.columns).toEqual([["a"], ["b"], ["d", "e"], ["h"]]);
    expect(chain.depth.get("h")).toBe(3);
    expect(chain.edges).toContainEqual({ from: "a", to: "c", status: ["active"], crossTrader: true });
    expect(chain.edges).toContainEqual({ from: "d", to: "f", status: ["failed"], crossTrader: true });
    expect(chain.edges).toContainEqual({ from: "a", to: "b", status: ["complete"], crossTrader: false });
    const cycle = traderChain(graph, "Fence");
    expect(cycle.columns.flat().toSorted()).toEqual(["y", "z"]);
    expect(cycle.columns.every((column, index) => column.every((id) => cycle.depth.get(id) === index))).toBe(true);
  });
});

describe("items still needed", () => {
  it("adds up needs by item, found-in-raid apart, with alternatives kept as choices", () => {
    const needed = itemsNeeded(graph, progress());
    expect(needed.items).toEqual([
      {
        id: "salewa",
        foundInRaid: 3,
        other: 1,
        quests: [
          { id: "a", count: 2, foundInRaid: true },
          { id: "a", count: 1, foundInRaid: false },
          { id: "g", count: 1, foundInRaid: true },
        ],
      },
    ]);
    expect(needed.choices).toEqual([{ quest: "a", need: QUESTS[0].needs[2] }]);
  });

  it("leaves out completed and other-faction quests and needs with an objective done", () => {
    expect(itemsNeeded(graph, progress({ completed: ["a"], faction: "BEAR" })).items).toEqual([]);
    const needed = itemsNeeded(graph, progress({ objectives: ["a-find", "a-meds"], faction: "USEC" }));
    expect(needed.items[0]).toMatchObject({ foundInRaid: 1, other: 1 });
    expect(needed.choices).toEqual([]);
  });

  it("can be limited to some quests", () => {
    const needed = itemsNeeded(graph, progress(), (entry) => entry.id === "g");
    expect(needed.items).toMatchObject([{ id: "salewa", foundInRaid: 1, other: 0 }]);
  });
});

describe("quest filters", () => {
  it("matches names, traders, and needed items' names", () => {
    expect(filterQuests(LIST, { text: "salewa" }).map((entry) => entry.id)).toEqual(["a", "g"]);
    expect(filterQuests(LIST, { text: "therap" }).map((entry) => entry.id)).toEqual(["c"]);
    expect(filterQuests(LIST, { text: "  " })).toHaveLength(QUESTS.length);
  });

  it("filters by trader, map page, level, Kappa, found-in-raid items, state and faction", () => {
    const ids = (filter: Parameters<typeof filterQuests>[1], statuses?: Parameters<typeof filterQuests>[2]) =>
      filterQuests(LIST, filter, statuses).map((entry) => entry.id);
    expect(ids({ trader: "Skier" })).toEqual(["f", "g"]);
    expect(ids({ map: "factory" })).toEqual(["a"]);
    expect(ids({ map: "night-factory" })).toEqual(["a"]);
    expect(ids({ minLevel: 8, maxLevel: 9 })).toEqual(["d", "e"]);
    expect(ids({ kappa: true })).toEqual(["a"]);
    expect(ids({ foundInRaid: true })).toEqual(["a", "g"]);
    const statuses = questStates(graph, progress({ completed: ["a"], faction: "BEAR" }));
    expect(ids({ states: ["available"] }, statuses)).toEqual(["b", "c"]);
    expect(ids({ ownFaction: true }, statuses)).not.toContain("g");
    expect(ids({ states: ["available"] })).toEqual([]);
  });
});
