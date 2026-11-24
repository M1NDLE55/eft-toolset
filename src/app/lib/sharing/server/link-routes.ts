import { linkObject, userObject, type DurableBindings } from "@/app/lib/durable/access";
import { copyPlanFromLink, createPlanLink, listPlanLinks, openPlanLink, revokePlanLink } from "./plan-service";
import type { LinkRoute } from "@/app/lib/durable/link-store";
import { createLinkCode, logCode, verifyLinkCode } from "@/app/lib/sharing/link-code";
import { newRecordId } from "@/app/lib/sharing/ids";
import type { BuildValue, GroupValue } from "@/app/lib/sharing/types";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import { appOrigin } from "@/app/lib/account/server";
import { bindings, errorResponse, fail, json, limitIp, NOINDEX, readJson, requireSameOrigin, route, RouteError, unwrapOutcome } from "./http";
import { linkKeys, sharingConfigured } from "./secrets";
import { callerSession, requireUser, withSession } from "./session";
import { recordRequestUsage } from "@/app/lib/usage/record";

/**
 * Links (§7, §10.3). View and copy links are /s/<code>; invites are /join#<code> (plans only).
 * A code is checked against its MAC in memory before any Durable Object is touched; its route
 * (which object owns it) is immutable, so it is cached per data centre; its state lives with the
 * target, so revoking takes effect at once.
 */

const ROUTE_CACHE = "https://cache.eft-toolset.internal/route/";
const SNAPSHOT_CACHE = "https://cache.eft-toolset.internal/snapshot/";
const ROUTE_TTL_SECONDS = 86_400;
/** A public snapshot may be served from the data centre's cache for this long (§7.4). */
export const SNAPSHOT_TTL_SECONDS = 10;

function edgeCache(): Cache | null {
  return typeof caches !== "undefined" && "default" in caches ? (caches as unknown as { default: Cache }).default : null;
}

export type TargetType = "build" | "item_group" | "plan";

/** The route for a code with a valid MAC, or null. Positive results are cached for a day; misses never are. */
export async function resolveCode(env: DurableBindings, code: string): Promise<LinkRoute | null> {
  if (!(await verifyLinkCode(code, linkKeys()))) return null;
  const cache = edgeCache();
  const key = `${ROUTE_CACHE}${code}`;
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return (await hit.json()) as LinkRoute;
  const route = await linkObject(env, code).resolve();
  if (route && cache) {
    await cache
      .put(key, Response.json(route, { headers: { "Cache-Control": `public, max-age=${ROUTE_TTL_SECONDS}` } }))
      .catch(() => undefined);
  }
  return route;
}

async function forgetSnapshot(code: string) {
  await edgeCache()?.delete(`${SNAPSHOT_CACHE}${code}`).catch(() => false);
}

export function shareUrl(request: Request, code: string) {
  return `${appOrigin(request)}/s/${code}`;
}

export function inviteUrl(request: Request, code: string) {
  return `${appOrigin(request)}/join#${code}`;
}

const EXPIRY_DAYS = [1, 7, 30];

interface CreateLinkBody {
  target?: { type?: string; id?: string };
  access?: string;
  role?: string;
  expiresIn?: number | null;
  maxUses?: number;
}

/** POST /api/links */
export function postLink(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    await limitIp(request, "link");
    const session = await requireUser(request);
    const body = await readJson<CreateLinkBody>(request);
    const link = await createLink(bindings(), session.userId, body, request);
    recordRequestUsage(request, { name: "link.create" }, session.userId);
    return withSession(json(link, 201, NOINDEX), session);
  });
}

/** Creates a link for the caller; shared by the HTTP route and the share_link MCP tool. */
export async function createLink(env: DurableBindings, userId: string, body: CreateLinkBody, request: Request) {
  if (!sharingConfigured()) {
    throw new RouteError(json({ error: { code: "unavailable", message: "Links aren't set up on this server yet." } }, 503), "Links aren't set up on this server yet.");
  }
  const type = body.target?.type;
  const id = body.target?.id;
  if ((type !== "build" && type !== "item_group" && type !== "plan") || typeof id !== "string") fail("invalid", "target needs a type (build, item_group or plan) and an id.");
  const access = body.access;
  if (access !== "view" && access !== "copy" && access !== "invite") fail("invalid", "access is view, copy or invite.");
  const code = await createLinkCode(linkKeys());
  if (type === "plan") return createPlanLink(env, userId, id, code, body, request);
  if (access === "invite") fail("invalid", "Invites are for raid plans only.");
  const expiresIn = body.expiresIn ?? null;
  if (expiresIn !== null && !EXPIRY_DAYS.includes(expiresIn)) fail("invalid", "Links expire after 1, 7 or 30 days, or never.");
  const created = unwrapOutcome(await userObject(env, userId).createLink(code, { type, id }, access, expiresIn));
  if (!(await linkObject(env, code).init({ targetKind: "user", targetName: userId }))) {
    await userObject(env, userId).revokeLink(code);
    fail("conflict", "That link couldn't be made. Try again.");
  }
  console.info(JSON.stringify({ event: "link_created", code: await logCode(code), type, access }));
  return { ...created, url: shareUrl(request, code) };
}

/** GET /api/links?type=&id= */
export function getLinks(request: Request) {
  return route(async () => {
    const session = await requireUser(request);
    const params = new URL(request.url).searchParams;
    const links = await listLinks(bindings(), session.userId, params.get("type") ?? "", params.get("id") ?? "", request);
    return withSession(json({ links }, 200, NOINDEX), session);
  });
}

export async function listLinks(env: DurableBindings, userId: string, type: string, id: string, request: Request) {
  if (type === "plan") return listPlanLinks(env, userId, id, request);
  if (type !== "build" && type !== "item_group") fail("invalid", "type is build, item_group or plan.");
  const record = await userObject(env, userId).record(type, id);
  if (!record || record.deleted) fail("not_found", "That doesn't exist in your library.");
  return (await userObject(env, userId).listLinks(type, id)).map((link) => ({ ...link, url: shareUrl(request, link.code) }));
}

/** DELETE /api/links/:code */
export function deleteLink(request: Request, code: string) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const link = await revokeLink(bindings(), session.userId, code);
    return withSession(json({ link }), session);
  });
}

export async function revokeLink(env: DurableBindings, userId: string, code: string) {
  const target = await resolveCode(env, code);
  if (!target) fail("not_found", "That link doesn't exist.");
  let revoked: unknown;
  if (target.targetKind === "user") {
    // Only the owner can revoke a build or group link; for anyone else it doesn't exist.
    if (target.targetName !== userId) fail("not_found", "That link doesn't exist.");
    revoked = unwrapOutcome(await userObject(env, userId).revokeLink(code));
  } else {
    revoked = await revokePlanLink(env, userId, target.targetName, code);
  }
  await forgetSnapshot(code);
  return revoked;
}

export interface SharedSnapshot {
  code: string;
  targetType: TargetType;
  access: "view" | "copy";
  allowCopy: boolean;
  ownerDisplayName: string;
  snapshot: BuildValue | GroupValue | PlanContent;
  /** Plans: the rev the snapshot is at, for the live socket's catch-up. */
  rev?: number;
}

/** Opens a /s/ code: route, then the target's state and content. */
export async function openShare(env: DurableBindings, code: string, viewerId: string | null): Promise<SharedSnapshot> {
  const target = await resolveCode(env, code);
  if (!target) fail("not_found", "That link doesn't exist.");
  if (target.targetKind === "user") {
    const opened = unwrapOutcome(await userObject(env, target.targetName).openLink(code, viewerId === target.targetName));
    return { code, targetType: opened.targetType, access: opened.access, allowCopy: opened.allowCopy, ownerDisplayName: opened.ownerDisplayName, snapshot: opened.snapshot };
  }
  const opened = await openPlanLink(env, target.targetName, code, viewerId);
  return { code, targetType: "plan", access: opened.access, allowCopy: opened.allowCopy, ownerDisplayName: opened.ownerDisplayName, snapshot: opened.plan, rev: opened.rev };
}

/**
 * GET /api/s/:code: the JSON snapshot behind a view or copy link. Public snapshots are cached for
 * 10 seconds per data centre, so a link that goes viral costs at most one Durable Object request
 * per data centre every 10 s. A revoked link can serve its last snapshot elsewhere for up to that long.
 */
export function getShare(request: Request, code: string) {
  return route(async () => {
    await limitIp(request, "share");
    const env = bindings();
    const cache = edgeCache();
    const key = `${SNAPSHOT_CACHE}${code}`;
    const hit = await cache?.match(key).catch(() => undefined);
    if (hit) return new Response(hit.body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-EFT-Cache": "HIT", ...NOINDEX } });
    const snapshot = await openShare(env, code, null);
    const body = JSON.stringify(snapshot);
    if (cache) {
      await cache
        .put(key, new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${SNAPSHOT_TTL_SECONDS}` } }))
        .catch(() => undefined);
    }
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...NOINDEX } });
  }, NOINDEX);
}

/** Copies a link's target into the caller's library: the copy is a new item with the copier's own defaults. */
export async function copyFromLink(env: DurableBindings, userId: string, code: string, name?: string): Promise<{ type: TargetType; id: string; name: string }> {
  const target = await resolveCode(env, code);
  if (!target) fail("not_found", "That link doesn't exist.");
  if (target.targetKind === "plan") return copyPlanFromLink(env, userId, target.targetName, code, name);
  const exported = unwrapOutcome(await userObject(env, target.targetName).exportForLink(code));
  const value = { ...(exported.snapshot as { name: string }), ...(name ? { name: name.slice(0, 120) } : {}) };
  // createCopy charges the copier's accepts-and-copies bucket in the same transaction as the copy.
  const created = unwrapOutcome(await userObject(env, userId).createCopy(exported.targetType, newRecordId(), value, (exported.snapshot as { name: string }).name));
  return { type: exported.targetType, id: created.id, name: created.name };
}

export function libraryUrl(item: { type: TargetType; id: string; name: string }) {
  if (item.type === "build") return `/gun-builder/${item.id}`;
  if (item.type === "item_group") return `/item-groups/${encodeURIComponent(item.name)}`;
  return `/raid-planner/p/${item.id}`;
}

/** POST /api/s/:code/copy */
export function postShareCopy(request: Request, code: string) {
  return route(async () => {
    requireSameOrigin(request);
    await limitIp(request, "share");
    const session = await requireUser(request);
    const body = await readJson<{ name?: string }>(request).catch(() => ({}) as { name?: string });
    const copied = await copyFromLink(bindings(), session.userId, code, typeof body.name === "string" ? body.name : undefined);
    recordRequestUsage(request, { name: "link.copy" }, session.userId);
    return withSession(json({ ...copied, url: libraryUrl(copied) }, 201), session);
  });
}

/** For server-rendered /s/ pages: the snapshot, or the error to show. */
export async function shareForPage(request: Request, code: string): Promise<{ ok: true; share: SharedSnapshot } | { ok: false; code: string; message: string }> {
  const response = await getShare(request, code);
  const body = (await response.json()) as SharedSnapshot | { error: { code: string; message: string } };
  if ("error" in body) return { ok: false, code: body.error.code, message: body.error.message };
  return { ok: true, share: body };
}

export async function viewerId(request: Request) {
  const session = await callerSession(request);
  return session.kind === "user" ? session.userId : null;
}

export { errorResponse };
