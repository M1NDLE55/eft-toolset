"use client";

import type { PlanSession, SessionView } from "@/app/lib/account-sync/plan-session";

/** Who is here. Filled in by live sessions; nothing to show over HTTP. */
export function PresenceBar(_props: { session: PlanSession; view: SessionView }) {
  return null;
}
