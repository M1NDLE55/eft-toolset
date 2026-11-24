import { PlanSession } from "@/app/lib/account-sync/plan-session";
import type { AccountLibrary } from "@/app/lib/account-sync/account-library";

/** The session a plan page uses: over HTTP, catching up every few seconds. */
export function createLiveSession(library: AccountLibrary, planId: string) {
  return new PlanSession(library, planId);
}
