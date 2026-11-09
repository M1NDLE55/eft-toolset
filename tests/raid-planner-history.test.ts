import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  recordChange,
  redoStep,
  undoStep,
  type PlanHistory,
} from "@/app/lib/raid-planner/history";
import type { RaidPlan } from "@/app/lib/raid-planner/types";

function plan(name: string, enabledLayers: string[] = []): RaidPlan {
  return {
    id: "p",
    name,
    mapKey: "customs",
    createdAt: 0,
    updatedAt: 0,
    enabledLayers,
    route: [],
    drawings: [],
    notes: [],
  };
}

describe("raid plan history", () => {
  it("undoes and redoes in order", () => {
    const a = plan("a");
    const b = plan("b");
    const c = plan("c");
    let history = recordChange(EMPTY_HISTORY, a);
    history = recordChange(history, b);

    const first = undoStep(history, c)!;
    expect(first.plan.name).toBe("b");
    const second = undoStep(first.history, first.plan)!;
    expect(second.plan.name).toBe("a");
    expect(undoStep(second.history, second.plan)).toBeNull();

    const redoB = redoStep(second.history, second.plan)!;
    expect(redoB.plan.name).toBe("b");
    const redoC = redoStep(redoB.history, redoB.plan)!;
    expect(redoC.plan.name).toBe("c");
    expect(redoStep(redoC.history, redoC.plan)).toBeNull();
  });

  it("drops the redo stack when a new change is recorded", () => {
    const history = recordChange(EMPTY_HISTORY, plan("a"));
    const undone = undoStep(history, plan("b"))!;
    expect(undone.history.future).toHaveLength(1);
    const changed = recordChange(undone.history, undone.plan);
    expect(changed.future).toHaveLength(0);
    expect(redoStep(changed, plan("c"))).toBeNull();
  });

  it("keeps the current layer selection when stepping through history", () => {
    const history = recordChange(EMPTY_HISTORY, plan("a", ["locks"]));
    const undone = undoStep(history, plan("b", ["extracts:pmc"]))!;
    expect(undone.plan.name).toBe("a");
    expect(undone.plan.enabledLayers).toEqual(["extracts:pmc"]);
    const redone = redoStep(undone.history, plan("a", ["hazards"]))!;
    expect(redone.plan.enabledLayers).toEqual(["hazards"]);
  });

  it("caps both stacks", () => {
    let history: PlanHistory = EMPTY_HISTORY;
    for (let index = 0; index < HISTORY_LIMIT + 20; index += 1) history = recordChange(history, plan(String(index)));
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0].name).toBe("20");
    let current = plan("current");
    for (let index = 0; index < HISTORY_LIMIT; index += 1) {
      const step = undoStep(history, current)!;
      history = step.history;
      current = step.plan;
    }
    expect(history.past).toHaveLength(0);
    expect(history.future).toHaveLength(HISTORY_LIMIT);
  });
});
