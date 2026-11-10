import { describe, expect, it } from "vitest";
import type { CachedTask, CachedTaskObjective } from "@/app/lib/cache/types";
import { summarizeNeeds, taskNeed } from "@/app/lib/item-needs";

function task(objectives: Partial<CachedTaskObjective>[], faction: string | null = null): CachedTask {
  return {
    name: "Task",
    minPlayerLevel: 1,
    wikiLink: null,
    trader: { name: "Therapist" },
    faction,
    objectives: objectives.map((objective) => ({ description: "objective", alternatives: 0, ...objective })),
  };
}

const find = (count: number, foundInRaid = true) => ({ type: "findItem", count, foundInRaid });
const give = (count: number, foundInRaid = true) => ({ type: "giveItem", count, foundInRaid });
const station = (name: string) => ({ name });

describe("item needs", () => {
  it("counts a find-and-hand-over pair once, by the hand-over", () => {
    expect(taskNeed(task([find(2), give(2)]))).toEqual({ count: 2, foundInRaid: 2 });
    expect(taskNeed(task([give(30, false)]))).toEqual({ count: 30, foundInRaid: 0 });
    // A find-only objective still means keeping the item until the task is done.
    expect(taskNeed(task([find(3)]))).toEqual({ count: 3, foundInRaid: 3 });
  });

  it("does not count objectives other items satisfy, optional ones, or ones that only use the item", () => {
    expect(taskNeed(task([{ ...give(10), alternatives: 10 }]))).toEqual({ count: 0, foundInRaid: 0 });
    expect(taskNeed(task([{ ...give(1), optional: true }]))).toEqual({ count: 0, foundInRaid: 0 });
    expect(taskNeed(task([{ type: "shoot", count: 12 }, { type: "buildWeapon", count: 1 }]))).toEqual({
      count: 0,
      foundInRaid: 0,
    });
  });

  it("totals tasks and hideout upgrades, counting faction-only tasks once", () => {
    const needs = summarizeNeeds({
      usedInTasks: [
        task([find(1), give(1)]),
        task([give(2, false)], "USEC"),
        task([give(3)], "BEAR"),
        task([{ ...give(5), alternatives: 50 }]),
      ],
      hideoutRequirements: [{ station: station("Medstation"), level: 3, count: 1, foundInRaid: false }],
      hideoutSlots: [],
    });
    expect(needs).toMatchObject({
      total: 5,
      foundInRaid: 4,
      forTasks: 4,
      taskCount: 2,
      forHideout: 1,
      upgradeCount: 1,
      otherTaskCount: 1,
    });
    expect(needs?.summary).toBe(
      "5 needed (4 FIR): 4 for 2 tasks (4 FIR); 1 for 1 hideout upgrade; not counted: 1 task using it or accepting other items"
    );
  });

  it("reports hideout slots without counting them as consumed", () => {
    const needs = summarizeNeeds({
      usedInTasks: [],
      hideoutRequirements: [],
      hideoutSlots: [
        { station: station("Bitcoin Farm"), level: 1, slots: 10 },
        { station: station("Bitcoin Farm"), level: 2, slots: 15 },
        { station: station("Bitcoin Farm"), level: 3, slots: 25 },
      ],
    });
    expect(needs).toMatchObject({ total: 0, hideoutSlots: 50, summary: "Bitcoin Farm holds up to 50 installed" });
  });

  it("returns null when nothing needs the item", () => {
    expect(summarizeNeeds({ usedInTasks: [], hideoutRequirements: [], hideoutSlots: [] })).toBeNull();
  });
});
