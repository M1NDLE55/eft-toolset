import type { GunsmithObjectiveView, GunsmithTaskView } from "@/app/lib/builds/gunsmith-pages";
import type { RequirementCheck } from "@/app/lib/builds/gunsmith";
import type { FaqEntry } from "./item";
import { formatRoubles } from "./format";

export const GUNSMITH_HUB_NAME = "Gunsmith builds";
export const GUNSMITH_HUB_TITLE = "Tarkov Gunsmith Builds: Ready Builds & Parts Lists for Every Part";
export const GUNSMITH_HUB_DESCRIPTION =
  "A ready build for every Gunsmith task in Escape from Tarkov, checked against the task's requirements, with every part and live flea and trader prices. Open any build in the gun builder.";

/** Stats the data can't check, with what to do about them in game. */
export const UNCHECKED_HINTS: Record<string, string> = {
  durability: "Buy the weapon new or repair it to this condition.",
  width: "Build size isn't in the data: check the weapon's size in the inspect screen, folding the stock if needed.",
  height: "Build size isn't in the data: check the weapon's size in the inspect screen.",
};

export function gunsmithTitle(view: Pick<GunsmithTaskView, "task">) {
  return `${view.task.name} Build: Parts List & Requirements`;
}

export function formatRequirement(check: Pick<RequirementCheck, "compareMethod" | "value" | "unit">) {
  const symbol = check.compareMethod === ">=" ? "at least" : check.compareMethod === "<=" ? "at most" : "exactly";
  return `${symbol} ${check.value}${check.unit}`;
}

function recoilSum(objective: GunsmithObjectiveView) {
  const build = objective.build;
  return build && build.recoilVertical !== null && build.recoilHorizontal !== null
    ? Math.round(build.recoilVertical + build.recoilHorizontal)
    : null;
}

function summary(objective: GunsmithObjectiveView) {
  const build = objective.build;
  if (!build) return null;
  const parts = [
    build.ergonomics !== null ? `${Math.round(build.ergonomics)} ergonomics` : null,
    recoilSum(objective) !== null ? `recoil sum ${recoilSum(objective)}` : null,
    `${build.weight.toFixed(2)} kg`,
  ].filter(Boolean);
  return parts.join(", ");
}

export function gunsmithDescription(view: GunsmithTaskView) {
  const solved = view.objectives.filter((objective) => objective.build);
  const names = view.objectives.map((objective) => objective.weapon.shortName);
  const weapons = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
  if (solved.length === view.objectives.length && solved.length > 0) {
    const first = solved[0];
    const cost = solved.reduce((total, objective) => total + (objective.build?.costRUB ?? 0), 0);
    return (
      `Ready ${weapons} ${solved.length > 1 ? "builds" : "build"} for ${view.task.name} that meets every requirement we can check` +
      (solved.length === 1 ? `: ${summary(first)}` : "") +
      (cost > 0 ? `, about ${formatRoubles(cost)}` : "") +
      ". Every part with live prices."
    );
  }
  return `${view.task.name} requirements for the ${weapons}: every stat limit and required part, with a starting build to open in the gun builder.`;
}

export function gunsmithFaq(view: GunsmithTaskView): FaqEntry[] {
  const entries: FaqEntry[] = [];
  const { task } = view;
  for (const objective of view.objectives) {
    const limits = objective.checks.map((check) => `${check.label.toLowerCase()} ${formatRequirement(check)}`);
    const parts = objective.requiredParts.map((part) => part.name);
    const categories = objective.requiredCategories.map((name) => `any ${name.toLowerCase()}`);
    entries.push({
      question: `What are the ${task.name} requirements${view.objectives.length > 1 ? ` for the ${objective.weapon.shortName}` : ""}?`,
      answer:
        `Build a ${objective.weapon.name} with ${limits.join(", ")}` +
        (parts.length || categories.length ? `, and install ${[...parts, ...categories].join(", ")}` : "") +
        ".",
    });
    if (objective.build) {
      entries.push({
        question: `What is a good ${objective.weapon.shortName} build for ${task.name}?`,
        answer:
          `The build on this page meets every requirement we can check (${summary(objective)})` +
          (objective.build.costRUB !== null ? ` and costs about ${formatRoubles(objective.build.costRUB)} from traders and the flea market` : "") +
          ". Open it in the gun builder to see each part or swap them.",
      });
    }
  }
  if (task.trader) {
    entries.push({
      question: `Who gives ${task.name}?`,
      answer:
        `${task.trader} gives ${task.name}` +
        (task.minPlayerLevel > 0 ? `, from player level ${task.minPlayerLevel}` : "") +
        (task.faction ? `, to ${task.faction} players only` : "") +
        ".",
    });
  }
  return entries;
}
