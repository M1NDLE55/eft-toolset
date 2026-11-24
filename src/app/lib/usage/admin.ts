import { clientIp, crossIsolateLimit } from "@/app/lib/api/rate-limit";
import { MemoryBuckets, type BucketLimit } from "@/app/lib/api/rate-limit-store";
import { SESSION_COOKIE } from "@/app/lib/account/cookies";
import { accountConfig, readSession, setSessionCookies } from "@/app/lib/account/server";
import { readCookie } from "@/app/lib/server/cookies";
import { sqlConfig, StatsConfigError, type SqlConfig } from "./sql";
import { DASHBOARD_RANGES, dailySummary, dashboardStats, summaryDate, type DashboardRange } from "./stats";

/**
 * The stats readers: the admin dashboard's data (GET /api/admin/stats), for website accounts listed
 * in STATS_ADMIN_USER_IDS, and the daily summary (GET /api/admin/stats/daily), for a script holding
 * STATS_READ_TOKEN. Both only read, and both are off (404) until their setting exists.
 */

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
/** A dashboard load runs about ten queries; this is plenty for a person and stops a loop. */
const READER_LIMIT: BucketLimit = { burst: 20, refillPerSecond: 0.2 };
const CACHE_MS = 5 * 60 * 1000;
const MIN_READ_TOKEN_LENGTH = 32;

const readers = new MemoryBuckets();
const cache = new Map<string, { at: number; body: Promise<unknown> }>();

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** The WorkOS user ids allowed to see the dashboard: STATS_ADMIN_USER_IDS, comma or space separated. */
export function adminUserIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.STATS_ADMIN_USER_IDS ?? "").split(/[\s,]+/).filter((id) => /^user_[A-Za-z0-9]{10,64}$/.test(id)));
}

export type AdminGate =
  | { kind: "admin"; userId: string; sealedSession?: string }
  | { kind: "off" }
  | { kind: "signed_out" }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

/** Whether the request's website session belongs to an admin. Uses the same session check as /api/account. */
export async function adminGate(request: Request): Promise<AdminGate> {
  const admins = adminUserIds();
  const config = accountConfig();
  if (admins.size === 0 || !config) return { kind: "off" };
  const session = await readSession(readCookie(request, SESSION_COOKIE), config);
  if (session.kind === "unavailable") return { kind: "unavailable" };
  if (session.kind === "signed_out") return { kind: "signed_out" };
  if (!admins.has(session.userId)) return { kind: "forbidden" };
  return { kind: "admin", userId: session.userId, sealedSession: session.sealedSession };
}

/** Compares two strings in time that depends only on their lengths, never on where they differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export type TokenGate = "ok" | "off" | "denied";

/** Whether the request carries `Authorization: Bearer <STATS_READ_TOKEN>`. Off when the token is unset or short. */
export function readTokenGate(request: Request, env: NodeJS.ProcessEnv = process.env): TokenGate {
  const expected = env.STATS_READ_TOKEN?.trim() ?? "";
  if (expected.length < MIN_READ_TOKEN_LENGTH) return "off";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  return match && constantTimeEqual(match[1], expected) ? "ok" : "denied";
}

async function rateLimited(request: Request): Promise<Response | null> {
  const ip = clientIp(request);
  if (ip !== null) {
    const budget = readers.consume(`stats:${ip}`, READER_LIMIT, 1);
    if (!budget.allowed) return json({ error: "Too many requests." }, 429, { "Retry-After": String(budget.retryAfterSeconds) });
  }
  const shared = await crossIsolateLimit(request, "web");
  return shared ? json({ error: "Too many requests." }, 429, { "Retry-After": String(shared.retryAfterSeconds) }) : null;
}

function sqlOrError(): SqlConfig | Response {
  try {
    return sqlConfig() ?? json({ error: "Stats aren't set up: STATS_CF_ACCOUNT_ID and STATS_CF_API_TOKEN are needed." }, 503);
  } catch (error) {
    return json({ error: error instanceof StatsConfigError ? error.message : "Stats aren't set up." }, 503);
  }
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.body as Promise<T>;
  const body = load();
  cache.set(key, { at: now, body });
  body.catch(() => cache.delete(key));
  return body;
}

async function answer(load: () => Promise<unknown>) {
  try {
    return json(await load());
  } catch (error) {
    console.error("Stats query failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "The stats couldn't be read. Try again shortly." }, 502);
  }
}

/** GET /api/admin/stats?days=7|30|90: the dashboard's data, for admins signed in on the website. */
export async function getAdminStats(request: Request): Promise<Response> {
  const limited = await rateLimited(request);
  if (limited) return limited;
  const gate = await adminGate(request);
  switch (gate.kind) {
    case "off":
      return json({ error: "Not found." }, 404);
    case "unavailable":
      return json({ error: "Your account can't be checked right now." }, 503);
    case "signed_out":
      return json({ error: "Sign in to see the stats." }, 401);
    case "forbidden":
      return json({ error: "This account can't see the stats." }, 403);
  }
  const days = Number(new URL(request.url).searchParams.get("days") ?? 7);
  if (!DASHBOARD_RANGES.includes(days as DashboardRange)) return json({ error: "days must be 7, 30 or 90." }, 400);
  const config = sqlOrError();
  if (config instanceof Response) return config;
  const response = await answer(() => cached(`dashboard:${days}`, () => dashboardStats(config, days as DashboardRange)));
  return gate.sealedSession ? setSessionCookies(response, gate.sealedSession) : response;
}

/** GET /api/admin/stats/daily?date=YYYY-MM-DD: one day's summary, for the STATS_READ_TOKEN holder. */
export async function getDailyStats(request: Request): Promise<Response> {
  const limited = await rateLimited(request);
  if (limited) return limited;
  const gate = readTokenGate(request);
  if (gate === "off") return json({ error: "Not found." }, 404);
  if (gate === "denied") return json({ error: "A valid bearer token is required." }, 401, { "WWW-Authenticate": 'Bearer realm="stats"' });
  const params = new URL(request.url).searchParams;
  const date = summaryDate(params.get("date") ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  if (!date) return json({ error: "date must be YYYY-MM-DD, today or within the last 90 days." }, 400);
  const config = sqlOrError();
  if (config instanceof Response) return config;
  return answer(() => cached(`daily:${date}`, () => dailySummary(config, date)));
}

/** Clears the readers' limits and cached answers. For tests. */
export function resetStatsReaders() {
  readers.clear();
  cache.clear();
}
