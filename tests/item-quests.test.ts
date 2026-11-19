import { describe, expect, it } from "vitest";
import { questsUsingItem } from "@/app/lib/quests/item-quests";
import type { QuestList, QuestSummary } from "@/app/lib/quests/types";

const quest = (id: string, fields: Partial<QuestSummary> = {}): QuestSummary => ({
  id,
  name: id,
  slug: id.toLowerCase(),
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
  ...fields,
});

const list = (quests: QuestSummary[]): QuestList => ({
  quests,
  items: {},
  maps: {
    customs: { key: "customs", name: "Customs", page: "customs" },
    factory: { key: "factory", name: "Factory", page: "factory" },
    "night-factory": { key: "night-factory", name: "Night Factory", page: "factory" },
  },
  traders: ["Prapor", "Therapist"],
});

describe("questsUsingItem", () => {
  it("sums one quest's needs for the item and counts how many must be found in raid", () => {
    const { needed } = questsUsingItem(
      list([
        quest("Sanitary Standards", {
          trader: "Therapist",
          needs: [
            { objectives: ["a"], items: ["gas"], count: 2, foundInRaid: true },
            { objectives: ["b"], items: ["gas"], count: 1, foundInRaid: false },
            { objectives: ["c"], items: ["other"], count: 5, foundInRaid: true },
          ],
        }),
      ]),
      "gas"
    );
    expect(needed).toHaveLength(1);
    expect(needed[0]).toMatchObject({ name: "Sanitary Standards", count: 3, foundInRaid: 2, anyOf: [] });
  });

  it("keeps alternatives apart, after the quests that need this very item", () => {
    const { needed } = questsUsingItem(
      list([
        quest("Medics", {
          minPlayerLevel: 2,
          needs: [{ objectives: ["a"], items: ["salewa", "ifak"], count: 3, foundInRaid: true, label: "Hand over medkits", alternatives: 40 }],
        }),
        quest("Specific", { minPlayerLevel: 30, needs: [{ objectives: ["a"], items: ["salewa"], count: 1, foundInRaid: false }] }),
        quest("Listless", { needs: [{ objectives: ["a"], items: ["ifak"], count: 1, foundInRaid: false }] }),
      ]),
      "salewa"
    );
    expect(needed.map((entry) => entry.name)).toEqual(["Specific", "Medics"]);
    expect(needed[1]).toMatchObject({
      count: 0,
      foundInRaid: 0,
      anyOf: [{ count: 3, foundInRaid: true, label: "Hand over medkits", accepted: 40 }],
    });
  });

  it("orders by level, then the game's trader order, and names faction quests and same-named quests apart", () => {
    const need = [{ objectives: ["a"], items: ["x"], count: 1, foundInRaid: false }];
    const { needed } = questsUsingItem(
      list([
        quest("Late", { minPlayerLevel: 20, needs: need }),
        quest("Textile USEC", { name: "Textile - Part 1", faction: "USEC", trader: "Ragman", needs: need }),
        quest("Textile BEAR", { name: "Textile - Part 1", faction: "BEAR", trader: "Ragman", needs: need }),
        quest("Early Therapist", { trader: "Therapist", minPlayerLevel: 0, needs: need }),
        quest("Battery 1", { name: "Battery Change", maps: ["customs"], needs: need }),
        quest("Battery 2", { name: "Battery Change", maps: ["factory"], needs: need }),
      ]),
      "x"
    );
    expect(needed.map((entry) => [entry.name, entry.hint])).toEqual([
      ["Battery Change", "on Customs"],
      ["Battery Change", "on Factory"],
      ["Early Therapist", null],
      ["Textile - Part 1 (BEAR)", null],
      ["Textile - Part 1 (USEC)", null],
      ["Late", null],
    ]);
  });

  it("lists quests that need the item as a key, with its maps merged, and leaves out quests without a page", () => {
    const result = questsUsingItem(
      list([
        quest("Exit", {
          keys: [
            { map: "factory", keys: ["exit-key", "other"] },
            { map: "night-factory", keys: ["exit-key"] },
          ],
          needs: [{ objectives: ["a"], items: ["exit-key"], count: 1, foundInRaid: true }],
        }),
        quest("Anywhere", { keys: [{ map: null, keys: ["exit-key"] }] }),
        quest("No Page", { slug: null, keys: [{ map: "customs", keys: ["exit-key"] }] }),
        quest("Unrelated", { keys: [{ map: "customs", keys: ["other"] }] }),
      ]),
      "exit-key"
    );
    expect(result.keys.map((entry) => [entry.name, entry.maps])).toEqual([
      ["Anywhere", []],
      ["Exit", ["Factory"]],
    ]);
    expect(result.needed.map((entry) => entry.name)).toEqual(["Exit"]);
  });

  it("finds nothing for an item no quest uses", () => {
    expect(questsUsingItem(list([quest("A")]), "x")).toEqual({ needed: [], keys: [] });
  });
});
