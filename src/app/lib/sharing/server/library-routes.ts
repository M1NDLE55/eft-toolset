import { userObject } from "@/app/lib/durable/access";
import { USER_LIMITS } from "@/app/lib/durable/limits";
import { DEVICE_HEADER } from "@/app/lib/durable/user-do";
import { newRecordId } from "@/app/lib/sharing/ids";
import type { Mutation } from "@/app/lib/sharing/types";
import { bindings, fail, json, limitIp, readJson, requireSameOrigin, requireSiteOrigin, route, unwrapOutcome } from "./http";
import { requireUser, withSession } from "./session";
import { importPlans } from "./plan-service";

/** Library routes (§10.1): the signed-in user's builds, item groups, settings and plan index. */

/** GET /api/library: the full snapshot, for the first load and a resync. */
export function getLibrary(request: Request) {
  return route(async () => {
    const session = await requireUser(request);
    return withSession(json(await userObject(bindings(), session.userId).library()), session);
  });
}

/** GET /api/library/changes?since=<seq> */
export function getLibraryChanges(request: Request) {
  return route(async () => {
    const session = await requireUser(request);
    const since = Number(new URL(request.url).searchParams.get("since"));
    if (!Number.isSafeInteger(since) || since < 0) fail("invalid", "since must be a sequence number.");
    return withSession(json(await userObject(bindings(), session.userId).changesSince(since)), session);
  });
}

/** POST /api/library/mutations: every write to builds, item groups and settings. */
export function postMutations(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ mutations?: Mutation[] }>(request);
    if (!Array.isArray(body.mutations) || body.mutations.length === 0) fail("invalid", "Send a list of mutations.");
    if (body.mutations.length > USER_LIMITS.batchSize) fail("invalid", `Send at most ${USER_LIMITS.batchSize} mutations per request.`);
    const results = unwrapOutcome(await userObject(bindings(), session.userId).applyMutations(body.mutations, "created"));
    return withSession(json({ results }), session);
  });
}

/** PATCH /api/library/:type/:id/settings: { allowCopy } */
export function patchItemSettings(request: Request, type: string, id: string) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const kind = type === "builds" || type === "build" ? "build" : type === "item-groups" || type === "item_group" ? "item_group" : null;
    if (!kind) fail("not_found", "Unknown item type.");
    const body = await readJson<{ allowCopy?: unknown }>(request);
    if (typeof body.allowCopy !== "boolean") fail("invalid", "allowCopy must be true or false.");
    const record = unwrapOutcome(await userObject(bindings(), session.userId).setAllowCopy(kind, id, body.allowCopy));
    return withSession(json({ record }), session);
  });
}

export interface ImportItem {
  type: "build" | "item_group" | "plan";
  value: unknown;
}

export type ImportResult =
  | { index: number; status: "created"; id: string }
  | { index: number; status: "duplicate"; id: string }
  | { index: number; status: "limit" | "too_large" | "invalid" | "rate_limited"; message: string };

const MAX_IMPORT_BYTES = 1024 * 1024;

/**
 * POST /api/library/import: migration and restore (§14.5). At most 50 items and 1 MiB per request.
 * Exact duplicates are skipped by content hash, so retrying a batch is safe.
 */
export function postImport(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ items?: ImportItem[]; origin?: string }>(request, MAX_IMPORT_BYTES);
    if (!Array.isArray(body.items) || body.items.length === 0) fail("invalid", "Send a list of items.");
    if (body.items.length > USER_LIMITS.batchSize) fail("invalid", `Send at most ${USER_LIMITS.batchSize} items per request.`);
    const origin = body.origin === "restore" ? "restore" : "migration";
    const results = await importItems(session.userId, body.items, origin);
    return withSession(json({ results }), session);
  });
}

export async function importItems(userId: string, items: ImportItem[], origin: "migration" | "restore"): Promise<ImportResult[]> {
  const env = bindings();
  const user = userObject(env, userId);
  const results: ImportResult[] = [];
  const plans: { index: number; value: unknown }[] = [];
  for (const [index, item] of items.entries()) {
    if (item?.type === "plan") {
      plans.push({ index, value: item.value });
      continue;
    }
    if (item?.type !== "build" && item?.type !== "item_group") {
      results.push({ index, status: "invalid", message: "Unknown item type." });
      continue;
    }
    if (new TextEncoder().encode(JSON.stringify(item.value ?? null)).byteLength > USER_LIMITS.entryBytes) {
      results.push({ index, status: "too_large", message: `Larger than ${USER_LIMITS.entryBytes / 1024} KB.` });
      continue;
    }
    const outcome = await user.importItem({ type: item.type, id: newRecordId(), value: item.value }, origin);
    if (outcome.ok) {
      results.push(
        outcome.value.status === "created" ? { index, status: "created", id: outcome.value.record.id } : { index, status: "duplicate", id: outcome.value.id }
      );
    } else {
      const status = outcome.error.code === "limit" ? "limit" : outcome.error.code === "rate_limited" ? "rate_limited" : "invalid";
      results.push({ index, status, message: outcome.error.message });
    }
  }
  results.push(...(await importPlans(env, userId, plans)));
  return results.sort((a, b) => a.index - b.index);
}

/** PATCH /api/profile: { displayName } */
export function patchProfile(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ displayName?: unknown }>(request);
    const displayName = unwrapOutcome(await userObject(bindings(), session.userId).setDisplayName(String(body.displayName ?? "")));
    return withSession(json({ displayName }), session);
  });
}

/** POST /api/notices/read: { ids } */
export function postNoticesRead(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    const session = await requireUser(request);
    const body = await readJson<{ ids?: unknown }>(request);
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is number => Number.isSafeInteger(id)) : [];
    await userObject(bindings(), session.userId).markNoticesRead(ids);
    return withSession(json({ ok: true }), session);
  });
}

/** GET /api/library/live?since=<seq>: the device's change feed, a hibernatable WebSocket in UserDO. */
export function libraryLive(request: Request) {
  return route(async () => {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") fail("invalid", "Expected a WebSocket upgrade.");
    requireSiteOrigin(request);
    await limitIp(request, "socket");
    const session = await requireUser(request);
    const url = new URL(request.url);
    const headers = new Headers();
    for (const [key, value] of request.headers) if (!key.toLowerCase().startsWith("x-eft-")) headers.set(key, value);
    headers.set(DEVICE_HEADER, (url.searchParams.get("device") ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64));
    const forwarded = new Request(`https://user.internal/live?since=${encodeURIComponent(url.searchParams.get("since") ?? "-1")}`, { headers });
    return userObject(bindings(), session.userId).fetch(forwarded);
  });
}
