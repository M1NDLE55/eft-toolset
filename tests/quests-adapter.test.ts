import { beforeEach, describe, expect, it, vi } from "vitest";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import {
  clearTarkovResourceCache,
  executeTarkovOperation,
  getQuestDetail,
  getQuestList,
  listQuestSlugs,
} from "@/app/lib/api/tarkov-server";
import { isQuestList } from "@/app/lib/quests/query";
import { createTarkovFixtures } from "./fixtures/tarkov";

type Data = { data: Record<string, unknown> };
let fixtures: Record<string, unknown> = createTarkovFixtures();

function questFixtures() {
  const all = createTarkovFixtures();
  const tasks = (all.tasks as Data).data as { tasks: Record<string, unknown>; questItems?: unknown; prestige?: unknown };
  tasks.tasks.first = {
    id: "first",
    name: "first-name",
    normalizedName: "first-quest",
    trader: "trader",
    minPlayerLevel: 5,
    kappaRequired: true,
    experience: 1_000,
    map: "map",
    wikiLink: "https://escapefromtarkov.fandom.com/wiki/First_Quest",
    taskImageLink: "https://assets.tarkov.dev/first.webp",
    objectives: [
      { id: "find-mod", type: "findItem", description: "find-mod", items: ["mod"], count: 2, foundInRaid: true, maps: ["night"] },
      { id: "give-mod", type: "giveItem", description: "give-mod", items: ["mod"], count: 2, foundInRaid: true, maps: [] },
      { id: "find-key", type: "findItem", items: ["key"], count: 1, foundInRaid: false },
      { id: "give-any", type: "giveItem", description: "give-any", items: ["weapon", "ammo", "ghost"], count: 3 },
      { id: "plant-mod", type: "plantItem", items: ["mod"], count: 1, optional: true },
      { id: "find-letter", type: "findQuestItem", questItem: "letter", requiredKeys: [["key", "ghost"]], maps: ["map"] },
      { type: "visit", description: "no id" },
    ],
    neededKeys: [{ map: "map", keys: ["key", "ghost"] }],
    startRewards: { items: [{ item: "key", count: 1 }] },
    finishRewards: {
      items: [{ item: "reward", count: 2 }, { item: "ghost", count: 1 }],
      traderStanding: [{ trader: "trader", standing: 0.02 }],
      offerUnlock: [{ trader: "trader", level: 2, item: "mod", attributes: [] }],
      skillLevelReward: [{ skill: "StressResistance", level: 1 }],
      traderUnlock: ["trader"],
      craftUnlock: [{ station: "station", level: 1, item: "reward", count: 1 }],
    },
  };
  tasks.tasks.usec = {
    id: "usec",
    name: "variant-name",
    normalizedName: "variant",
    trader: "trader",
    factionName: "USEC",
    taskRequirements: [{ task: "first", status: ["complete", "unknown-status"] }],
    failConditions: [{ id: "fail", type: "taskStatus", task: "bear", status: ["complete"] }],
    requiredPrestige: "prestige-2",
  };
  tasks.tasks.bear = {
    id: "bear",
    name: "variant-name",
    normalizedName: "variant",
    trader: "trader",
    factionName: "BEAR",
    taskRequirements: [{ task: "first", status: ["active"] }],
  };
  tasks.tasks.branch = {
    id: "branch",
    name: "branch-name",
    trader: "trader",
    minPlayerLevel: 30,
    taskRequirements: [{ task: "usec", status: ["failed"] }, { task: "missing", status: ["complete"] }],
  };
  tasks.prestige = [{ id: "prestige-2", prestigeLevel: 2 }];
  tasks.questItems = { letter: { name: "letter-name", gridImageLink: "https://assets.tarkov.dev/letter.webp" } };
  Object.assign((all.tasks_en as Data).data, {
    "first-name": "First Quest",
    "variant-name": "Variant",
    "branch-name": "Branch",
    "find-mod": "Find the mod in raid",
    "give-mod": "Hand over the mod",
    "give-any": "Hand over any gun",
    "letter-name": "Sealed letter",
  });
  const maps = (all.maps as Data).data.maps as Record<string, Record<string, unknown>>;
  maps.map.name = "factory-name";
  maps.night = { normalizedName: "night-factory", name: "night-name" };
  Object.assign((all.maps_en as Data).data, { "factory-name": "Factory", "night-name": "Night Factory" });
  return all;
}

beforeEach(() => {
  fixtures = questFixtures();
  clearTarkovResourceCache();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const resource = new URL(String(input)).pathname.split("/").pop()!;
    const fixture = fixtures[resource];
    if (!fixture) return new Response("missing fixture", { status: 404 });
    return new Response(JSON.stringify(fixture), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});

describe("the quest list", () => {
  it("projects each quest with its maps, requirements, keys and objective ids", async () => {
    const list = await getQuestList("regular");
    const first = list.quests.find((quest) => quest.id === "first")!;
    expect(first).toMatchObject({
      name: "First Quest",
      slug: "first-quest",
      trader: "Tester",
      minPlayerLevel: 5,
      faction: null,
      kappaRequired: true,
      lightkeeperRequired: false,
      experience: 1_000,
      maps: ["factory", "night-factory"],
      keys: [{ map: "factory", keys: ["key"] }],
      objectives: ["find-mod", "give-mod", "find-key", "give-any", "find-letter"],
      optionalObjectives: ["plant-mod"],
      image: "https://assets.tarkov.dev/first.webp",
    });
    expect(list.maps["night-factory"]).toEqual({ key: "night-factory", name: "Night Factory", page: "factory" });
    expect(list.traders).toEqual(["Tester"]);
    expect(list.items.mod).toEqual({ name: "Test Mod", shortName: "Mod", slug: "test-mod", image: null });
    expect(list.items).not.toHaveProperty("ghost");
    expect(isQuestList(list)).toBe(true);
  });

  it("counts finding and handing over the same items once, and lists alternatives honestly", async () => {
    const first = (await getQuestList("regular")).quests.find((quest) => quest.id === "first")!;
    expect(first.needs).toEqual([
      { objectives: ["give-mod", "find-mod"], items: ["mod"], count: 2, foundInRaid: true },
      {
        objectives: ["give-any"],
        items: ["weapon", "ammo"],
        count: 3,
        foundInRaid: false,
        label: "Hand over any gun",
        alternatives: 2,
      },
      { objectives: ["find-key"], items: ["key"], count: 1, foundInRaid: false },
    ]);
  });

  it("keeps known requirement statuses and the quests whose completion fails one", async () => {
    const quests = new Map((await getQuestList("regular")).quests.map((quest) => [quest.id, quest]));
    expect(quests.get("usec")).toMatchObject({
      faction: "USEC",
      prestige: 2,
      requires: [{ id: "first", status: ["complete"] }],
      failedBy: [{ id: "bear", status: ["complete"] }],
    });
    expect(quests.get("branch")!.requires).toEqual([
      { id: "usec", status: ["failed"] },
      { id: "missing", status: ["complete"] },
    ]);
  });

  it("gives faction variants of one slug their own, and tasks without one none", async () => {
    const quests = new Map((await getQuestList("regular")).quests.map((quest) => [quest.id, quest]));
    expect(quests.get("usec")!.slug).toBe("variant-usec");
    expect(quests.get("bear")!.slug).toBe("variant-bear");
    expect(quests.get("branch")!.slug).toBeNull();
    expect(await listQuestSlugs("regular")).not.toContain("variant");
  });

  it("is served as the quest.list operation, which takes only the game mode", async () => {
    const list = await executeTarkovOperation(TARKOV_OPERATIONS.questList, { gameMode: "regular" });
    expect(isQuestList(list)).toBe(true);
    await expect(
      executeTarkovOperation(TARKOV_OPERATIONS.questList, { gameMode: "regular", trader: "x" })
    ).rejects.toThrow(/unsupported/);
  });

  it("rejects malformed rewards and objectives", async () => {
    const tasks = ((fixtures.tasks as Data).data.tasks as Record<string, Record<string, unknown>>);
    tasks.first.finishRewards = { traderUnlock: [{ id: "trader" }] };
    await expect(getQuestList("regular")).rejects.toThrow("invalid tasks data");
    clearTarkovResourceCache();
    tasks.first.finishRewards = {};
    tasks.first.objectives = [{ id: "o", requiredKeys: ["key"] }];
    await expect(getQuestList("regular")).rejects.toThrow("invalid tasks data");
  });
});

describe("a quest's detail", () => {
  it("returns null for an unknown slug", async () => {
    expect(await getQuestDetail("regular", "no-such-quest")).toBeNull();
  });

  it("names objectives, quest items, keys, maps and priced items", async () => {
    const detail = (await getQuestDetail("regular", "first-quest"))!;
    expect(detail.gameMode).toBe("regular");
    expect(detail.wikiLink).toBe("https://escapefromtarkov.fandom.com/wiki/First_Quest");
    expect(detail.objectives.map((objective) => objective.id)).toEqual([
      "find-mod",
      "give-mod",
      "find-key",
      "give-any",
      "plant-mod",
      "find-letter",
    ]);
    expect(detail.objectives[0]).toEqual({
      id: "find-mod",
      type: "findItem",
      description: "Find the mod in raid",
      count: 2,
      foundInRaid: true,
      optional: false,
      maps: ["night-factory"],
      items: ["mod"],
      alternatives: 1,
      questItem: null,
      requiredKeys: [],
    });
    expect(detail.objectives[4].optional).toBe(true);
    expect(detail.objectives[5]).toMatchObject({
      questItem: { name: "Sealed letter", image: "https://assets.tarkov.dev/letter.webp" },
      requiredKeys: [["key"]],
      maps: ["factory"],
    });
    expect(detail.items.mod).toMatchObject({ name: "Test Mod", buy: { price: 10_000, vendor: "Tester" } });
    expect(detail.items.reward).toMatchObject({ name: "Reward", buy: null, sell: null });
    expect(Object.keys(detail.maps).sort()).toEqual(["factory", "night-factory"]);
  });

  it("names rewards: items, standing, offers, skills, traders and crafts", async () => {
    const detail = (await getQuestDetail("regular", "first-quest"))!;
    expect(detail.rewards).toEqual({
      items: [{ id: "reward", count: 2 }],
      traderStanding: [{ trader: "Tester", standing: 0.02 }],
      offerUnlocks: [{ id: "mod", trader: "Tester", level: 2 }],
      skills: [{ name: "Stress Resistance", level: 1 }],
      traderUnlocks: ["Tester"],
      craftUnlocks: [{ id: "reward", count: 1, station: "Workbench", level: 1 }],
    });
    expect(detail.startRewards.items).toEqual([{ id: "key", count: 1 }]);
  });

  it("lists what the quest unlocks and the chain around it, without failure branches", async () => {
    const detail = (await getQuestDetail("regular", "first-quest"))!;
    expect(detail.prerequisites).toEqual([]);
    expect(detail.unlocks).toEqual(
      expect.arrayContaining([
        { id: "usec", status: ["complete"] },
        { id: "bear", status: ["active"] },
      ])
    );
    expect(detail.chain.before).toEqual([]);
    expect(detail.chain.after.toSorted()).toEqual(["bear", "usec"]);
    expect(detail.quests.usec).toEqual({
      id: "usec",
      name: "Variant",
      slug: "variant-usec",
      trader: "Tester",
      minPlayerLevel: 0,
      faction: "USEC",
    });

    const usec = (await getQuestDetail("regular", "variant-usec"))!;
    expect(usec.chain.before).toEqual(["first"]);
    expect(usec.unlocks).toEqual([{ id: "branch", status: ["failed"] }]);
    expect(usec.chain.after).toEqual([]);
    expect(usec.quests.bear.name).toBe("Variant");
  });
});
