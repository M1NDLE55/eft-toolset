import type { DurableBindings } from "@/app/lib/durable/access";
import type { ImportResult } from "./library-routes";
import { fail } from "./http";
import type { PlanContent } from "@/app/lib/sharing/plan-content";

/** Account raid plans. Moving plans to an account arrives with PlanDO's content model. */
export async function importPlans(_env: DurableBindings, _userId: string, plans: { index: number; value: unknown }[]): Promise<ImportResult[]> {
  return plans.map(({ index }) => ({ index, status: "invalid", message: "Raid plans can't be moved to an account yet." }));
}

const NOT_YET = "Raid plans can't be shared from an account yet.";

export async function createPlanLink(..._args: unknown[]): Promise<never> {
  return fail("invalid", NOT_YET);
}
export async function listPlanLinks(..._args: unknown[]): Promise<never> {
  return fail("invalid", NOT_YET);
}
export async function revokePlanLink(..._args: unknown[]): Promise<never> {
  return fail("not_found", "That link doesn't exist.");
}
export async function openPlanLink(..._args: unknown[]): Promise<{ access: "view" | "copy"; allowCopy: boolean; ownerDisplayName: string; plan: PlanContent; rev: number }> {
  return fail("not_found", "That link doesn't exist.");
}
export async function copyPlanFromLink(..._args: unknown[]): Promise<{ type: "plan"; id: string; name: string }> {
  return fail("not_found", "That link doesn't exist.");
}
export async function acceptInvite(..._args: unknown[]): Promise<{ planId: string; role: string }> {
  return fail("not_found", "That invite doesn't exist.");
}
