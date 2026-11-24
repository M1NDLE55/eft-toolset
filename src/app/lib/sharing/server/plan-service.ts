import type { DurableBindings } from "@/app/lib/durable/access";
import type { ImportResult } from "./library-routes";

/** Account raid plans. Moving plans to an account arrives with PlanDO's content model. */
export async function importPlans(_env: DurableBindings, _userId: string, plans: { index: number; value: unknown }[]): Promise<ImportResult[]> {
  return plans.map(({ index }) => ({ index, status: "invalid", message: "Raid plans can't be moved to an account yet." }));
}
