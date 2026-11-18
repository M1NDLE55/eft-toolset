import { describe, expect, it } from "vitest";
import { questName, requirementLabel } from "@/app/lib/quests/display";
import type { QuestDetail, QuestSummary } from "@/app/lib/quests/types";
import { questDescription, questFaq, questHubFaq, questTitle } from "@/app/lib/seo/quests";

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
  it("titles the page with the quest name and what the page covers", () => {
    expect(questTitle(detail)).toBe("Sanitary Standards - Part 1 Quest: Objectives, Items & Rewards");
    expect(questTitle({ quest: { ...summary, name: "Textile - Part 1", faction: "USEC" } })).toBe("Textile - Part 1 (USEC) Quest: Objectives, Items & Rewards");
    expect(questName({ name: "New Beginning", prestige: 2 })).toBe("New Beginning (Prestige 2)");
  });

  it("describes the giver, level, items and first rewards within a search snippet", () => {
    const description = questDescription(detail);
    expect(description).toBe(
      "Sanitary Standards - Part 1: Therapist quest from level 12. 3 objectives, 2 items to hand over (1 found in raid), needed for Kappa. Rewards: 8,400 XP, 45,000 ₽."
    );
    expect(description.length).toBeLessThanOrEqual(160);
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
