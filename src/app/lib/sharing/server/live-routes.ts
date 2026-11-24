import { planObject } from "@/app/lib/durable/access";
import { PLAN_ACTOR_HEADER, PLAN_LINK_HEADER } from "@/app/lib/durable/plan-do";
import { bindings, fail, limitIp, requireSiteOrigin, route } from "./http";
import { resolveCode } from "./link-routes";
import { requireUser } from "./session";

/**
 * Live plan sockets (§11.1). Browsers can't set Authorization on a WebSocket upgrade, so a member's
 * session cookie is the credential; the Origin must be this site (against cross-site WebSocket
 * hijacking). The Worker strips any x-eft-* header the client sent and sets who the caller is.
 */
function forward(request: Request, set: Record<string, string>) {
  const headers = new Headers();
  for (const [key, value] of request.headers) if (!key.toLowerCase().startsWith("x-eft-")) headers.set(key, value);
  for (const [key, value] of Object.entries(set)) headers.set(key, value);
  const since = new URL(request.url).searchParams.get("since") ?? "-1";
  return new Request(`https://plan.internal/live?since=${encodeURIComponent(since)}`, { headers });
}

async function upgradeChecks(request: Request) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") fail("invalid", "Expected a WebSocket upgrade.");
  requireSiteOrigin(request);
  await limitIp(request, "socket");
}

/** GET /api/plans/:id/live — members. */
export function planLive(request: Request, planId: string) {
  return route(async () => {
    await upgradeChecks(request);
    const session = await requireUser(request);
    return planObject(bindings(), planId).fetch(forward(request, { [PLAN_ACTOR_HEADER]: session.userId }));
  });
}

/** GET /api/s/:code/live — anonymous viewers of a plan's view or copy link. */
export function shareLive(request: Request, code: string) {
  return route(async () => {
    await upgradeChecks(request);
    const target = await resolveCode(bindings(), code);
    if (!target || target.targetKind !== "plan") fail("not_found", "That link doesn't exist.");
    return planObject(bindings(), target.targetName).fetch(forward(request, { [PLAN_LINK_HEADER]: code }));
  });
}
