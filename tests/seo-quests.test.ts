import { describe, expect, it } from "vitest";
import { questName, requirementLabel } from "@/app/lib/quests/display";
import type { QuestDetail, QuestSummary } from "@/app/lib/quests/types";
import { questDescription, questFaq, questHubFaq, questSummary, questTitle, roughly } from "@/app/lib/seo/quests";

const ROUBLES = "5449016a4bdc2d6f028b456f";

const summary: QuestSummary = {
  id: "q1",
  name: "Sanitary Standards - Part 1",
  slug: "sanitary-standards-part-1",
  trader: "Therapist",
  minPlayerLevel: 12,
  faction: null,
  kappaRequired: true,
  lightkeeperRequired: false,
  maps: ["customs"],
  requires: [{ id: "q0", status: ["complete"] }],
  traderLevels: [],
  failedBy: [{ id: "q9", status: ["complete"] }],
  prestige: null,
  experience: 8_400,
  needs: [
    { objectives: ["o2", "o1"], items: ["gas"], count: 2, foundInRaid: true },
    { objectives: ["o3"], items: ["salewa", "ifak"], count: 1, foundInRaid: false, label: "Hand over medkits", alternatives: 2 },
  ],
  keys: [{ map: "customs", keys: ["dorm"] }],
  objectives: ["o1", "o2", "o3"],
  optionalObjectives: [],
  image: null,
};

const objective = (id: string) => ({
  id,
  type: "giveItem",
  description: id,
  count: 1,
  foundInRaid: false,
  optional: false,
  maps: [],
  items: [],
  alternatives: 0,
  questItem: null,
  requiredKeys: [],
  conditions: [],
});

const ref = (id: string, name: string) => ({ id, name, slug: id, trader: "Therapist", minPlayerLevel: 1, faction: null });
const item = (name: string) => ({ name, shortName: null, slug: null, image: null, buy: null, sell: null });

const detail: QuestDetail = {
  gameMode: "regular",
  quest: summary,
  wikiLink: null,
  restartable: false,
  objectives: [objective("o1"), objective("o2"), objective("o3")],
  rewards: {
    items: [{ id: ROUBLES, count: 45_000 }, { id: "salewa", count: 2 }],
    traderStanding: [{ trader: "Therapist", standing: 0.03 }],
    offerUnlocks: [{ id: "ifak", trader: "Therapist", level: 2 }],
    skills: [],
    traderUnlocks: [],
    craftUnlocks: [],
  },
  startRewards: { items: [], traderStanding: [], offerUnlocks: [], skills: [], traderUnlocks: [], craftUnlocks: [] },
  prerequisites: summary.requires,
  unlocks: [{ id: "q2", status: ["complete"] }],
  chain: { before: ["q0"], after: ["q2"] },
  quests: { q0: ref("q0", "Shortage"), q1: ref("q1", summary.name), q2: ref("q2", "Sanitary Standards - Part 2"), q9: ref("q9", "Other Branch") },
  items: { gas: item("Gas analyzer"), salewa: item("Salewa first aid kit"), ifak: item("IFAK individual first aid kit"), dorm: item("Dorm room 314 marked key") },
  maps: { customs: { key: "customs", name: "Customs", page: "customs" } },
};

describe("quest SEO copy", () => {
  it("titles the page with the quest name, Tarkov, and as much of what it covers as fits in 60 characters", () => {
    expect(questTitle(detail)).toBe("Sanitary Standards - Part 1 – Tarkov Quest Guide & Rewards");
    const titled = (name: string, overrides: Partial<QuestSummary> = {}) => questTitle({ quest: { ...summary, name, ...overrides } });
    expect(titled("Debut", { keys: [], needs: [] })).toBe("Debut – Tarkov Quest Guide: Objectives & Rewards");
    expect(titled("Shortage", { keys: [] })).toBe("Shortage – Tarkov Quest Guide: Objectives, Items & Rewards");
    expect(titled("Delivery From the Past")).toBe("Delivery From the Past – Tarkov Quest Guide: Keys & Rewards");
    expect(titled("Textile - Part 1", { faction: "USEC", keys: [] })).toBe("Textile - Part 1 (USEC) – Tarkov Quest Guide & Rewards");
    expect(titled("The Survivalist Path - Combat Medic")).toBe("The Survivalist Path - Combat Medic – Tarkov Quest Guide");
    // Too long for any tail: still says what it is.
    expect(titled("The Survivalist Path - Unprotected but Dangerous")).toBe("The Survivalist Path - Unprotected but Dangerous – Tarkov Quest");
    expect(questName({ name: "New Beginning", prestige: 2 })).toBe("New Beginning (Prestige 2)");
    for (const name of ["A", "Delivery From the Past", "The Survivalist Path - Combat Medic", "Gunsmith - Part 22"]) {
      expect(titled(name).length).toBeLessThanOrEqual(60);
      expect(titled(name)).toContain("Tarkov Quest");
    }
  });

  it("describes the giver, maps, keys, found-in-raid items and main reward in a search snippet", () => {
    const description = questDescription(detail);
    expect(description).toBe(
      "Sanitary Standards - Part 1 is Therapist's level 12 quest on Customs. Bring the Dorm room 314 marked key. Hand over 3 items, 2 found in raid. Rewards: 8,400 XP."
    );
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("names the items and the main reward and unlock when there's room, and fills out short ones", () => {
    const simple: QuestDetail = {
      ...detail,
      quest: { ...summary, name: "Shortage", minPlayerLevel: 1, keys: [], kappaRequired: false, needs: [{ objectives: ["o1"], items: ["salewa"], count: 3, foundInRaid: true }] },
      unlocks: [],
    };
    const description = questDescription(simple);
    expect(description).toBe(
      "Shortage is Therapist's quest on Customs. Hand over 3× Salewa first aid kit (found in raid). Unlocks IFAK individual first aid kit at Therapist LL2."
    );
    expect(description.length).toBeLessThanOrEqual(160);

    const bare: QuestDetail = { ...simple, quest: { ...simple.quest, needs: [], maps: [], trader: "Prapor" }, rewards: { ...detail.rewards, offerUnlocks: [], items: [] } };
    expect(questDescription(bare)).toBe("Shortage is Prapor's quest. Objectives: o1; o2; o3. Rewards: 8,400 XP. See every objective and reward.");
  });

  it("merges an item handed over in parts and says when items are planted", () => {
    const merged: QuestDetail = {
      ...detail,
      quest: {
        ...summary,
        keys: [],
        needs: [
          { objectives: ["o1"], items: ["gas"], count: 2, foundInRaid: true },
          { objectives: ["o2"], items: ["gas"], count: 1, foundInRaid: false },
        ],
      },
    };
    expect(questDescription(merged)).toContain("Hand over 3× Gas analyzer (2 found in raid).");
    const planted: QuestDetail = {
      ...merged,
      objectives: merged.objectives.map((entry) => ({ ...entry, type: "plantItem" })),
      quest: { ...merged.quest, needs: [{ objectives: ["o1"], items: ["gas"], count: 1, foundInRaid: false }] },
    };
    expect(questDescription(planted)).toContain("Plant 1× Gas analyzer.");
    expect(questSummary(planted)[1]).toMatch(/^You plant 1× Gas analyzer\./);
  });

  it("writes a summary brief from the data: giver and access, maps, what to bring, notes, and what follows", () => {
    const priced: QuestDetail = {
      ...detail,
      items: {
        ...detail.items,
        dorm: { ...detail.items.dorm, buy: { price: 21_333, vendor: "Flea Market" } },
      },
      objectives: [
        { ...objective("o1"), maps: ["customs"] },
        { ...objective("o2"), maps: ["factory"] },
        objective("o3"),
        { ...objective("o4"), type: "shoot", conditions: [{ kind: "usingWeapon", groups: [["salewa"]] }] },
        { ...objective("o5"), optional: true, questItem: { name: "Secure Folder 0022", image: null } },
      ],
      maps: { ...detail.maps, factory: { key: "factory", name: "Factory", page: "factory" } },
    };
    expect(questSummary(priced)).toEqual([
      "Therapist gives Sanitary Standards - Part 1 from level 12 and once you complete Shortage. The objectives take you to Customs.",
      "Bring the Dorm room 314 marked key (about 21,000 ₽ on the flea market). You hand over 2× Gas analyzer (found in raid) and 1× any of Salewa first aid kit and IFAK individual first aid kit. The 2 found-in-raid items have to come out of your own raids: ones bought from a trader or the flea market won't count, so keep them as you loot.",
      "The objectives are spread over 2 maps, so plan on more than one raid. Some objectives only count with particular gear, a weapon, mods or what you wear, so check them before you load out. You pick up Secure Folder 0022 in raid and have to extract with it.",
      "Completing it gives 8,400 XP, 45,000 ₽ and 2× Salewa first aid kit, and unlocks IFAK individual first aid kit at Therapist LL2. It leads to Sanitary Standards - Part 2. You need it for the Kappa container.",
    ]);
  });

  it("keeps the summary short for a quest with nothing to bring, any map and no follow-up", () => {
    const open: QuestDetail = {
      ...detail,
      quest: { ...summary, name: "Debut", trader: "Prapor", minPlayerLevel: 1, requires: [], failedBy: [], needs: [], keys: [], kappaRequired: false, maps: ["customs", "factory"] },
      objectives: [{ ...objective("o1"), type: "shoot", maps: ["customs", "factory"] }],
      prerequisites: [],
      unlocks: [],
      rewards: { ...detail.rewards, items: [{ id: ROUBLES, count: 80_000 }], offerUnlocks: [], traderStanding: [] },
      maps: { ...detail.maps, factory: { key: "factory", name: "Factory", page: "factory" } },
    };
    expect(questSummary(open)).toEqual([
      "Prapor gives Debut from the start, with nothing to do first. You can do it on Customs or Factory.",
      "There's nothing to hand over and no key to bring.",
      "Completing it gives 8,400 XP and 80,000 ₽. No other quest follows from it. It isn't needed for the Kappa container.",
    ]);
  });

  it("rounds prices to two significant figures", () => {
    expect([roughly(21_333), roughly(126_520), roughly(950), roughly(8)]).toEqual([21_000, 130_000, 950, 8]);
  });

  it("answers who gives it, what it needs, what it rewards and where it leads", () => {
    const faq = questFaq(detail);
    expect(faq.map((entry) => entry.question)).toEqual([
      "Who gives Sanitary Standards - Part 1 in Tarkov?",
      "What items do you need for Sanitary Standards - Part 1?",
      "What are the rewards for Sanitary Standards - Part 1?",
      "Is Sanitary Standards - Part 1 needed for Kappa?",
      "What does Sanitary Standards - Part 1 unlock?",
      "Can Sanitary Standards - Part 1 fail?",
    ]);
    expect(faq[0].answer).toBe("Therapist gives Sanitary Standards - Part 1, from player level 12. First complete Shortage.");
    expect(faq[1].answer).toBe(
      "Hand over 2× Gas analyzer (found in raid) and 1× any of Salewa first aid kit and IFAK individual first aid kit. Bring Dorm room 314 marked key."
    );
    expect(faq[2].answer).toBe("8,400 XP, 45,000 ₽, 2× Salewa first aid kit, +0.03 Therapist standing and unlocks IFAK individual first aid kit at Therapist LL2.");
    expect(faq[5].answer).toBe("Yes. Completing Other Branch fails Sanitary Standards - Part 1, so choose one branch.");
  });

  it("lists the Kappa quests on the hub from the data", () => {
    const faq = questHubFaq({ quests: [summary], items: {}, maps: {}, traders: [] });
    expect(faq.find((entry) => entry.question.includes("Kappa"))?.answer).toBe(
      "tarkov.dev lists 1 quest as needed for the Kappa container: Sanitary Standards - Part 1."
    );
    expect(questHubFaq(null).some((entry) => entry.question.includes("Kappa"))).toBe(false);
  });

  it("phrases what a requirement asks of the other quest", () => {
    expect(requirementLabel(["complete"])).toBe("complete");
    expect(requirementLabel(["active", "complete"])).toBe("start or complete");
    expect(requirementLabel(["active"])).toBe("start");
    expect(requirementLabel(["failed"])).toBe("fail");
    expect(requirementLabel(["complete", "failed"])).toBe("complete or fail");
  });
});
