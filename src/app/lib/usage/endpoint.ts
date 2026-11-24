import { clientIp, crossIsolateLimit } from "@/app/lib/api/rate-limit";
import { MemoryBuckets, consumeTokens, type BucketLimit } from "@/app/lib/api/rate-limit-store";
import { RequestBodyBusyError, RequestBodyTooLargeError, readBodyWithLimit } from "@/app/lib/api/request-body";
import { SESSION_COOKIE } from "@/app/lib/account/cookies";
import { accountConfig, isSameOriginRequest, workosClient } from "@/app/lib/account/server";
import { readCookie } from "@/app/lib/server/cookies";
import { USAGE_EVENTS, isUsageEventName, type UsageEvent } from "./catalog";
import { checkedEvent, recordUsage, requestCountry, requestIdentity } from "./record";

/** The beacon is a few dozen bytes; anything near this is not one. */
export const MAX_BEACON_BYTES = 512;
/** Per client IP in this isolate: page views and actions, with room for a burst of navigation. */
const CLIENT_LIMIT: BucketLimit = { burst: 60, refillPerSecond: 0.5 };
/** Every beacon this isolate accepts, whoever sends them. */
const ISOLATE_LIMIT: BucketLimit = { burst: 600, refillPerSecond: 50 };

const clients = new MemoryBuckets();
const isolate = { tokens: ISOLATE_LIMIT.burst, updatedAt: Date.now() };

/** The fields a beacon may send. Anything else, or a field the event doesn't take, refuses it. */
const BEACON_FIELDS = new Set(["event", "subject", "gameMode", "outcome", "duration", "route"]);

const NO_STORE = { "Cache-Control": "no-store" };

function reply(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers: { ...NO_STORE, ...headers } });
}

/** Global Privacy Control or Do Not Track. The browser checks these too; this catches any it missed. */
export function requestOptsOut(request: Request) {
  return request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1";
}

/**
 * A beacon's event, checked against the catalogue: a website event, only the fields it takes, each
 * a short string. Null for anything else.
 */
export function beaconEvent(body: unknown): UsageEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (!BEACON_FIELDS.has(key) || typeof value !== "string" || value.length > 64) return null;
  }
  const name = fields.event;
  if (!isUsageEventName(name)) return null;
  const spec = USAGE_EVENTS[name];
  if (spec.source !== "web") return null;
  if (fields.subject !== undefined && !("subject" in spec)) return null;
  const event = {
    name,
    subject: fields.subject !== undefined && "subject" in spec ? { kind: spec.subject, id: fields.subject } : undefined,
    gameMode: fields.gameMode,
    outcome: fields.outcome,
    duration: fields.duration,
    route: fields.route,
  } as UsageEvent;
  return checkedEvent(event);
}

/**
 * The signed-in user's id from the session cookie, read without calling WorkOS: the cookie is sealed
 * with our own password, so its contents are ours. It is hashed into the day's id and never kept.
 */
async function sessionUserId(request: Request): Promise<string | undefined> {
  const sessionData = readCookie(request, SESSION_COOKIE);
  const config = sessionData ? accountConfig() : null;
  if (!sessionData || !config) return undefined;
  try {
    const session = await workosClient(config).userManagement.getSessionFromCookie({
      sessionData,
      cookiePassword: config.cookiePassword,
    });
    return session?.user?.id;
  } catch {
    return undefined;
  }
}

/** POST /api/usage: one website event from this site's own pages, sent with navigator.sendBeacon. */
export async function postUsage(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return reply(403);
  // Opted out: accepted and dropped, so the page sees no difference.
  if (requestOptsOut(request)) return reply(204);

  const ip = clientIp(request);
  const limited = (retryAfterSeconds: number) => reply(429, { "Retry-After": String(retryAfterSeconds) });
  if (ip !== null) {
    const client = clients.consume(`usage:${ip}`, CLIENT_LIMIT, 1);
    if (!client.allowed) return limited(client.retryAfterSeconds);
  }
  const shared = await crossIsolateLimit(request, "web");
  if (shared) return limited(shared.retryAfterSeconds);
  const total = consumeTokens(isolate, ISOLATE_LIMIT, Date.now(), 1);
  if (!total.allowed) return limited(total.retryAfterSeconds);

  let body: unknown;
  try {
    body = JSON.parse(await readBodyWithLimit(request, MAX_BEACON_BYTES));
  } catch (error) {
    return reply(error instanceof RequestBodyBusyError ? 503 : error instanceof RequestBodyTooLargeError ? 413 : 400);
  }
  const event = beaconEvent(body);
  if (!event) return reply(400);
  recordUsage({ ...event, country: requestCountry(request) }, requestIdentity(request, ip, await sessionUserId(request)));
  return reply(204);
}

/** Clears the beacon rate limits. For tests. */
export function resetUsageLimits() {
  clients.clear();
  isolate.tokens = ISOLATE_LIMIT.burst;
  isolate.updatedAt = Date.now();
}
