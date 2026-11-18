import { beforeEach, describe, expect, it } from "vitest";
import { applyRestore, BACKUP_STORES, createBackup, parseBackup } from "@/app/lib/storage/backup";
import { readStore, writeStore } from "@/app/lib/storage/versioned-store";
import { questGraph } from "@/app/lib/quests/graph";
import {
  MAX_COMPLETED_QUESTS,
  QUEST_PROGRESS_STORE,
  completeQuest,
  resetQuestProgress,
  setFaction,
  setObjectiveDone,
  setPlayerLevel,
  uncompleteQuest,
} from "@/app/lib/quests/progress-store";
import type { QuestSummary } from "@/app/lib/quests/types";

const quest = (id: string, requires: QuestSummary["requires"] = []): QuestSummary => ({
  id,
  name: id,
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

const graph = questGraph([
  quest("a"),
  quest("b", [{ id: "a", status: ["complete"] }]),
  quest("c", [{ id: "b", status: ["complete"] }, { id: "x", status: ["active"] }]),
  quest("x"),
]);

const progress = () => readStore(QUEST_PROGRESS_STORE);

describe("quest progress", () => {
  beforeEach(() => localStorage.clear());

  it("keeps each game mode apart, completing a quest with what it needed completed", () => {
    expect(completeQuest("regular", graph, "c").toSorted()).toEqual(["a", "b", "c"]);
    expect(completeQuest("regular", graph, "b")).toEqual([]);
    expect(progress().regular.completed.toSorted()).toEqual(["a", "b", "c"]);
    expect(progress().pve.completed).toEqual([]);
    // A quest the list no longer has is still recorded.
    expect(completeQuest("pve", graph, "gone")).toEqual(["gone"]);
  });

  it("un-completes only the quest asked for", () => {
    completeQuest("regular", graph, "c");
    uncompleteQuest("regular", "a");
    expect(progress().regular.completed.toSorted()).toEqual(["b", "c"]);
  });

  it("marks objectives, level and faction, and resets one mode", () => {
    setObjectiveDone("pve", "obj-1", true);
    setObjectiveDone("pve", "obj-1", true);
    setObjectiveDone("pve", "obj-2", true);
    setObjectiveDone("pve", "obj-2", false);
    setPlayerLevel("pve", 42);
    setFaction("pve", "BEAR");
    expect(progress().pve).toEqual({ completed: [], objectives: ["obj-1"], level: 42, faction: "BEAR" });
    expect(() => setPlayerLevel("pve", 0)).toThrow(/invalid/);
    expect(() => setPlayerLevel("pve", 2.5)).toThrow(/invalid/);
    completeQuest("regular", graph, "a");
    resetQuestProgress("pve");
    expect(progress().pve).toEqual({ completed: [], objectives: [], level: null, faction: null });
    expect(progress().regular.completed).toEqual(["a"]);
  });

  it("rejects malformed data and recovers what it can", () => {
    expect(QUEST_PROGRESS_STORE.validate({ regular: { completed: [], objectives: [], level: null, faction: null } })).toBe(false);
    const empty = { completed: [], objectives: [], level: null, faction: null };
    expect(QUEST_PROGRESS_STORE.validate({ regular: empty, pve: { ...empty, completed: ["a", "a"] } })).toBe(false);
    expect(
      QUEST_PROGRESS_STORE.validate({ regular: empty, pve: { ...empty, completed: Array.from({ length: MAX_COMPLETED_QUESTS + 1 }, (_, i) => `q${i}`) } })
    ).toBe(false);
    localStorage.setItem(
      QUEST_PROGRESS_STORE.key,
      JSON.stringify({
        version: 1,
        data: {
          regular: { completed: ["a", "a", "../bad", 7], objectives: "nope", level: 500, faction: "Scav" },
          pve: { completed: ["b"], objectives: ["o"], level: 12, faction: "USEC" },
        },
      })
    );
    expect(progress()).toEqual({
      regular: { completed: ["a"], objectives: [], level: null, faction: null },
      pve: { completed: ["b"], objectives: ["o"], level: 12, faction: "USEC" },
    });
    localStorage.setItem(QUEST_PROGRESS_STORE.key, JSON.stringify({ version: 1, data: "broken" }));
    expect(progress()).toEqual(QUEST_PROGRESS_STORE.defaultValue());
  });

  it("is backed up and restored, replacing rather than merging", () => {
    expect(BACKUP_STORES.find((store) => store.definition === QUEST_PROGRESS_STORE)?.label).toBe("Quest progress");
    completeQuest("regular", graph, "b");
    const text = JSON.stringify(createBackup());
    localStorage.clear();
    const plan = parseBackup(text);
    const entry = plan.entries.find((candidate) => candidate.key === QUEST_PROGRESS_STORE.key)!;
    expect(entry).toMatchObject({ label: "Quest progress", mergeable: false, count: null });
    writeStore(QUEST_PROGRESS_STORE, QUEST_PROGRESS_STORE.defaultValue());
    applyRestore(plan, "merge");
    expect(progress().regular.completed).toEqual([]);
    applyRestore(plan, "replace");
    expect(progress().regular.completed.toSorted()).toEqual(["a", "b"]);
  });
});
