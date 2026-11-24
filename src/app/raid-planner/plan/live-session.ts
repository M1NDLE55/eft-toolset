import { PlanSession } from "@/app/lib/account-sync/plan-session";
import type { AccountLibrary } from "@/app/lib/account-sync/account-library";

/** The session a plan page uses: live over a WebSocket, with HTTP as the fallback and for offline replay. */
export function createLiveSession(library: AccountLibrary, planId: string) {
  const session = new PlanSession(library, planId);
  const open = session.open.bind(session);
  session.open = async (options) => {
    await open(options);
    session.connectLive();
  };
  const close = session.close.bind(session);
  session.close = () => {
    close();
  };
  return session;
}
