import { planObject } from "@/app/lib/durable/access";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import type { PlanOp } from "@/app/lib/sharing/plan-doc";
import { bindings, fail, json, limitIp, NOINDEX, readJson, requireSameOrigin, route, unwrapOutcome } from "./http";
import {
  acceptInvite,
  applyPlanOps,
  copyPlanAsMember,
  createAccountPlan,
  destroyPlan,
  leavePlan,
  previewInvite,
  removeMember,
  setMemberRole,
  setPlanAllowCopy,
  transferPlan,
} from "./plan-service";
import { libraryUrl } from "./link-routes";
import { requireUser, withSession } from "./session";
import { recordRequestUsage } from "@/app/lib/usage/record";

/** Plan routes (§10.2) and invites (§10.3). Non-members get 404, never 403, so ids reveal nothing. */

const MAX_PLAN_BODY = 384 * 1024;

/** POST /api/plans: { content, id?, offlineCopy? } — a new account plan (or one made offline, under its client id). */
export function postPlan(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ content?: PlanContent; id?: string; offlineCopy?: boolean }>(request, MAX_PLAN_BODY);
    if (!body.content || typeof body.content !== "object") fail("invalid", "Send the plan's content.");
    const created = await createAccountPlan(bindings(), session.userId, body.content, { kind: body.offlineCopy ? "offline-copy" : "create", id: body.id });
    recordRequestUsage(request, { name: "plan.host", subject: { kind: "map", id: created.summary.mapKey } }, session.userId);
    return withSession(json({ planId: created.planId, summary: created.summary, url: `/raid-planner/p/${created.planId}` }, 201), session);
  });
}

/** GET /api/plans/:id[?since=<rev>]: the snapshot, or the batches after `since`. */
export function getPlan(request: Request, planId: string) {
  return route(async () => {
    const session = await requireUser(request);
    const sinceParam = new URL(request.url).searchParams.get("since");
    const plan = planObject(bindings(), planId);
    const body = sinceParam === null ? { snapshot: unwrapOutcome(await plan.snapshot(session.userId)) } : unwrapOutcome(await plan.since(session.userId, Number(sinceParam)));
    return withSession(json(body, 200, NOINDEX), session);
  });
}

/** POST /api/plans/:id/ops: { opId, ops, knownRev? } — the WebSocket `ops` message for clients without a socket. */
export function postPlanOps(request: Request, planId: string) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ opId?: string; ops?: PlanOp[]; knownRev?: number }>(request, MAX_PLAN_BODY);
    if (!Array.isArray(body.ops)) fail("invalid", "Send a list of ops.");
    const result = await applyPlanOps(bindings(), { id: session.userId, name: "", via: "web" }, planId, String(body.opId ?? ""), body.ops, typeof body.knownRev === "number" ? body.knownRev : undefined);
    return withSession(json({ ack: { opId: body.opId, rev: result.rev }, ops: result.ops, duplicate: result.duplicate, catchUp: result.catchUp }), session);
  });
}

/** PATCH /api/plans/:id/settings: { allowCopy } (owner). */
export function patchPlanSettings(request: Request, planId: string) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ allowCopy?: unknown }>(request);
    if (typeof body.allowCopy !== "boolean") fail("invalid", "allowCopy must be true or false.");
    return withSession(json(await setPlanAllowCopy(bindings(), session.userId, planId, body.allowCopy)), session);
  });
}

/** POST /api/plans/:id/copy: { name? } */
export function postPlanCopy(request: Request, planId: string) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ name?: string }>(request).catch(() => ({}) as { name?: string });
    const copied = await copyPlanAsMember(bindings(), session.userId, planId, typeof body.name === "string" ? body.name : undefined);
    return withSession(json({ ...copied, url: libraryUrl(copied) }, 201), session);
  });
}

/** GET /api/plans/:id/members */
export function getPlanMembers(request: Request, planId: string) {
  return route(async () => {
    const session = await requireUser(request);
    return withSession(json({ members: unwrapOutcome(await planObject(bindings(), planId).members(session.userId)) }, 200, NOINDEX), session);
  });
}

async function memberUser(viewerId: string, planId: string, key: string) {
  return unwrapOutcome(await planObject(bindings(), planId).userForKey(viewerId, key));
}

/** PATCH /api/plans/:id/members/:key: { role } (owner). */
export function patchPlanMember(request: Request, planId: string, key: string) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ role?: string }>(request);
    if (body.role !== "editor" && body.role !== "viewer") fail("invalid", "The role is editor or viewer.");
    await setMemberRole(bindings(), session.userId, planId, await memberUser(session.userId, planId, key), body.role);
    return withSession(json({ members: unwrapOutcome(await planObject(bindings(), planId).members(session.userId)) }), session);
  });
}

/** DELETE /api/plans/:id/members/:key: the owner removes anyone; a member removes themselves (leave). */
export function deletePlanMember(request: Request, planId: string, key: string) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const userId = await memberUser(session.userId, planId, key);
    const result = userId === session.userId ? await leavePlan(bindings(), session.userId, planId) : await removeMember(bindings(), session.userId, planId, userId);
    return withSession(json({ result: typeof result === "string" ? result : "removed" }), session);
  });
}

/** POST /api/plans/:id/leave: the caller leaves (an owner hands the plan to the next member). */
export function postPlanLeave(request: Request, planId: string) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    return withSession(json({ result: await leavePlan(bindings(), session.userId, planId) }), session);
  });
}

/** POST /api/plans/:id/transfer: { to: memberKey } (owner). The former owner becomes an editor. */
export function postPlanTransfer(request: Request, planId: string) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ to?: string }>(request);
    if (typeof body.to !== "string") fail("invalid", "Name the member to hand the plan to.");
    await transferPlan(bindings(), session.userId, planId, await memberUser(session.userId, planId, body.to));
    return withSession(json({ ok: true }), session);
  });
}

/** DELETE /api/plans/:id (owner): final. */
export function deletePlanRoute(request: Request, planId: string) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    await destroyPlan(bindings(), session.userId, planId);
    return withSession(json({ deleted: true }), session);
  });
}

/** POST /api/invites/preview: { code } → the plan's name, map, role, inviter and expiry. No account needed. */
export function postInvitePreview(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    await limitIp(request, "invite");
    const body = await readJson<{ code?: string }>(request);
    const preview = await previewInvite(bindings(), String(body.code ?? ""));
    return json({ name: preview.name, mapKey: preview.mapKey, role: preview.role, inviter: preview.inviter, expiresAt: preview.expiresAt }, 200, NOINDEX);
  }, NOINDEX);
}

/** POST /api/invites/accept: { code } */
export function postInviteAccept(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    await limitIp(request, "invite");
    const session = await requireUser(request);
    const body = await readJson<{ code?: string }>(request);
    const joined = await acceptInvite(bindings(), session.userId, String(body.code ?? ""));
    if (joined.joined) recordRequestUsage(request, { name: "link.join" }, session.userId);
    return withSession(json({ ...joined, url: `/raid-planner/p/${joined.planId}` }), session);
  }, NOINDEX);
}
