import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ItemQuestLinks } from "@/app/components/item/item-quests";
import { questsUsingItem } from "@/app/lib/quests/item-quests";
import type { QuestList, QuestSummary } from "@/app/lib/quests/types";

const quest = (id: string, fields: Partial<QuestSummary> = {}): QuestSummary => ({
  id,
  name: id,
  slug: id.toLowerCase().replace(/ /g, "-"),
  trader: "Therapist",
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
  maps: { factory: { key: "factory", name: "Factory", page: "factory" } },
  traders: ["Therapist"],
});

function render(quests: QuestSummary[], itemId: string) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<ItemQuestLinks quests={questsUsingItem(list(quests), itemId)} />);
  return host;
}

const rowOf = (host: HTMLElement, href: string) => host.querySelector(`a[href="${href}"]`)!.closest("li")!;

describe("ItemQuestLinks", () => {
  it("links each quest that needs the item, with its count, FIR, trader and level", () => {
    const host = render(
      [
        quest("Sanitary Standards", {
          needs: [
            { objectives: ["a"], items: ["gas"], count: 2, foundInRaid: true },
            { objectives: ["b"], items: ["gas"], count: 1, foundInRaid: false },
          ],
        }),
        quest("Part 2", { minPlayerLevel: 8, needs: [{ objectives: ["a"], items: ["gas"], count: 2, foundInRaid: true }] }),
        quest("Shopping", { needs: [{ objectives: ["a"], items: ["gas", "x"], count: 4, foundInRaid: false, label: "Hand over electronics", alternatives: 7 }] }),
      ],
      "gas"
    );
    expect(host.querySelector("h2")?.textContent).toBe("Needed for quests");
    expect(Array.from(host.querySelectorAll("a"), (a) => a.getAttribute("href"))).toEqual([
      "/quests/sanitary-standards",
      "/quests/part-2",
      "/quests/shopping",
    ]);
    expect(rowOf(host, "/quests/sanitary-standards").textContent).toContain("×3");
    expect(rowOf(host, "/quests/sanitary-standards").textContent).toContain("2 FIR");
    expect(rowOf(host, "/quests/part-2").textContent).toContain("Therapist · Level 8");
    expect(rowOf(host, "/quests/part-2").textContent).toMatch(/FIR.*×2/);
    expect(rowOf(host, "/quests/shopping").textContent).toContain("×4any of 7 accepted items: Hand over electronics");
    expect(rowOf(host, "/quests/shopping").textContent).not.toContain("FIR");
    expect(host.textContent).not.toContain("Used in quests");
  });

  it("links the quests that use a key, with the map, and folds long lists into Show more", () => {
    const quests = Array.from({ length: 14 }, (_, index) => quest(`Key Quest ${index + 1}`, { minPlayerLevel: index + 1, keys: [{ map: "factory", keys: ["key"] }] }));
    const host = render(quests, "key");
    expect(host.querySelector("h2")?.textContent).toBe("Used in quests");
    expect(host.querySelectorAll("a")).toHaveLength(14);
    expect(rowOf(host, "/quests/key-quest-1").textContent).toContain("Factory");
    expect(host.querySelector("details summary")?.textContent).toBe("Show 2 more");
    expect(host.querySelector('details a[href="/quests/key-quest-14"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Needed for quests");
  });

  it("renders nothing when no quest uses the item", () => {
    expect(render([quest("A")], "x").innerHTML).toBe("");
  });
});
