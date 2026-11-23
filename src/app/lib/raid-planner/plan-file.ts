import type { RaidPlan } from "./types";
import { getMapConfig } from "./maps-config";
import { MAX_PLANS } from "./limits";
import { describePlanProblem, pickPlanFields } from "./plan-validation";
import { slugifyPlanName } from "./share";

export const PLAN_FILE_FORMAT = "eft-toolset/raid-plans";
export const PLAN_FILE_VERSION = 1;
export const MAX_PLAN_FILE_BYTES = 5 * 1024 * 1024;

export interface PlanFile {
  format: typeof PLAN_FILE_FORMAT;
  version: typeof PLAN_FILE_VERSION;
  exportedAt: string;
  plans: RaidPlan[];
}

export class PlanFileError extends Error {}

export function createPlanFile(plans: RaidPlan[], now = new Date()): string {
  const file: PlanFile = {
    format: PLAN_FILE_FORMAT,
    version: PLAN_FILE_VERSION,
    exportedAt: now.toISOString(),
    plans: plans.map(pickPlanFields),
  };
  return JSON.stringify(file);
}

export function planFileName(plans: RaidPlan[], now = new Date()) {
  if (plans.length === 1) return `raid-plan-${slugifyPlanName(plans[0].name)}.json`;
  return `raid-plans-${now.toISOString().slice(0, 10)}.json`;
}

function describeEntry(index: number, value: unknown) {
  const name =
    value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string"
      ? (value as { name: string }).name.trim().slice(0, 40)
      : "";
  return name ? `Plan ${index + 1} ("${name}")` : `Plan ${index + 1}`;
}

export function parsePlanFile(text: string): RaidPlan[] {
  if (text.length > MAX_PLAN_FILE_BYTES) {
    throw new PlanFileError(`This file is too large. Plan files can be at most ${MAX_PLAN_FILE_BYTES / 1024 / 1024} MB.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PlanFileError("This file isn't valid JSON. Choose a raid plan file exported from EFT Toolset.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PlanFileError("This isn't a raid plan file exported from EFT Toolset.");
  }
  const file = parsed as Partial<Record<keyof PlanFile, unknown>>;
  if (file.format !== PLAN_FILE_FORMAT) {
    throw new PlanFileError("This isn't a raid plan file exported from EFT Toolset.");
  }
  if (typeof file.version !== "number" || !Number.isInteger(file.version) || file.version < 1) {
    throw new PlanFileError("This plan file has an unsupported version.");
  }
  if (file.version > PLAN_FILE_VERSION) {
    throw new PlanFileError("This plan file was made by a newer version of EFT Toolset. Reload the page and try again.");
  }
  if (!Array.isArray(file.plans) || file.plans.length === 0) {
    throw new PlanFileError("This plan file doesn't contain any plans.");
  }
  if (file.plans.length > MAX_PLANS) {
    throw new PlanFileError(`This plan file contains ${file.plans.length} plans. At most ${MAX_PLANS} can be imported.`);
  }
  return file.plans.map((entry: unknown, index) => {
    const problem = describePlanProblem(entry);
    if (problem) throw new PlanFileError(`${describeEntry(index, entry)} ${problem}.`);
    const plan = pickPlanFields(entry as RaidPlan);
    if (!getMapConfig(plan.mapKey)) {
      throw new PlanFileError(`${describeEntry(index, entry)} uses a map that isn't available.`);
    }
    return plan;
  });
}

export async function readPlanFile(file: Blob): Promise<RaidPlan[]> {
  if (file.size > MAX_PLAN_FILE_BYTES) {
    throw new PlanFileError(`This file is too large. Plan files can be at most ${MAX_PLAN_FILE_BYTES / 1024 / 1024} MB.`);
  }
  if (file.size === 0) throw new PlanFileError("This file is empty.");
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new PlanFileError("This file couldn't be read.");
  }
  return parsePlanFile(text);
}

export function downloadPlanFile(plans: RaidPlan[]) {
  const now = new Date();
  const url = URL.createObjectURL(new Blob([createPlanFile(plans, now)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = planFileName(plans, now);
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
