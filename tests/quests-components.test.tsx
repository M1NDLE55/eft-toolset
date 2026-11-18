import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matchingRows } from "@/app/components/quests/items-needed-view";
import { mapChoices } from "@/app/components/quests/quest-filters";
import { lockedReason } from "@/app/components/quests/quest-bits";
import { useQuestActions } from "@/app/components/quests/use-quest-actions";
import { questGraph } from "@/app/lib/quests/graph";
import { QUEST_PROGRESS_STORE, useQuestProgress } from "@/app/lib/quests/progress-store";
import type { QuestList, QuestSummary } from "@/app/lib/quests/types";
import { readStore, writeStore } from "@/app/lib/storage/versioned-store";

const quest = (id: string, requires: QuestSummary["requires"] = []): QuestSummary => ({
  id,
  name: id.toUpperCase(),
  slug: id,
  trader: "Prapor",
  minPlayerLevel: 1,
  faction: null,
  kappaRequired: false,
  lightkeeperRequired: false,
  maps: [],
  requires,
  traderLevels: [],
  failedBy: [],
  prestige: null,
  experience: 0,
  needs: [],
  keys: [],
  objectives: [],
  optionalObjectives: [],
  image: null,
});

const graph = questGraph([quest("a"), quest("b", [{ id: "a", status: ["complete"] }]), quest("c", [{ id: "b", status: ["complete"] }])]);

function Harness() {
  const progress = useQuestProgress("regular");
  const actions = useQuestActions("regular", graph, progress);
  return (
    <div>
      {["a", "b", "c"].map((id) => (
        <button key={id} type="button" data-quest={id} onClick={() => actions.toggle(id)}>
          {id}
        </button>
      ))}
      <p data-notice>{actions.notice?.text}</p>
      {actions.dialog}
    </div>
  );
}

describe("marking quests complete", () => {
  let host: HTMLDivElement;
  let root: Root;
  const click = (selector: string) => act(() => (document.querySelector(selector) as HTMLElement).click());
  const completed = () => readStore(QUEST_PROGRESS_STORE).regular.completed.toSorted();
  const button = (label: string) => Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent === label)!;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    writeStore(QUEST_PROGRESS_STORE, QUEST_PROGRESS_STORE.defaultValue());
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("says which earlier quests completing one also marked", () => {
    click('[data-quest="c"]');
    expect(completed()).toEqual(["a", "b", "c"]);
    expect(document.querySelector("[data-notice]")?.textContent).toBe("Marked C complete, and 2 earlier quests it needed: B, A.");
  });

  it("un-marks a quest nothing later needed without asking", () => {
    click('[data-quest="c"]');
    click('[data-quest="c"]');
    expect(completed()).toEqual(["a", "b"]);
    expect(document.body.textContent).not.toContain("Un-mark A?");
  });

  it("asks before un-marking a quest later completed quests needed, and can un-mark only it or them too", () => {
    click('[data-quest="c"]');
    click('[data-quest="a"]');
    expect(document.body.textContent).toContain("You marked 2 later quests complete that needed it: B, C.");
    act(() => button("Only this quest").click());
    expect(completed()).toEqual(["b", "c"]);

    click('[data-quest="a"]');
    click('[data-quest="b"]');
    act(() => button("Un-mark all").click());
    expect(completed()).toEqual(["a"]);
    expect(document.querySelector("[data-notice]")?.textContent).toBe("Un-marked 2 quests.");
  });
});

describe("quest view helpers", () => {
  const list: QuestList = {
    quests: [],
    items: {
      gas: { name: "Gas analyzer", shortName: "GasAn", slug: "gas-analyzer", image: null },
      salewa: { name: "Salewa first aid kit", shortName: "Salewa", slug: "salewa", image: null },
    },
    maps: {
      factory: { key: "factory", name: "Factory", page: "factory" },
      "night-factory": { key: "night-factory", name: "Night Factory", page: "factory" },
      "ground-zero-21": { key: "ground-zero-21", name: "Ground Zero 21+", page: "ground-zero" },
      arena: { key: "arena", name: "Arena", page: null },
    },
    traders: [],
  };

  it("offers one map choice per page, named after the base map when it is listed", () => {
    expect(mapChoices(list)).toEqual([
      { key: "arena", name: "Arena" },
      { key: "factory", name: "Factory" },
      { key: "ground-zero", name: "Ground Zero 21+" },
    ]);
  });

  it("searches shopping rows by item name or short name", () => {
    const rows = [
      { id: "gas", count: 1, quests: [] },
      { id: "salewa", count: 2, quests: [] },
    ];
    expect(matchingRows(rows, list.items, "gasan").map((row) => row.id)).toEqual(["gas"]);
    expect(matchingRows(rows, list.items, "first aid").map((row) => row.id)).toEqual(["salewa"]);
    expect(matchingRows(rows, list.items, "  ")).toBe(rows);
  });

  it("explains why a quest is locked", () => {
    expect(
      lockedReason(
        { state: "locked", level: 15, otherFaction: true, missing: [{ id: "a", status: ["active"] }, { id: "b", status: ["complete"] }] },
        (id) => id.toUpperCase()
      )
    ).toBe("Other faction · Level 15 · start A · complete B");
  });
});
