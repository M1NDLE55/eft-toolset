// @vitest-environment node
import { readFile } from "node:fs/promises";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authCallback, signIn } from "@/app/lib/account/routes";
import { SESSION_COOKIE, STATE_COOKIE } from "@/app/lib/account/cookies";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { runTool } from "@/app/lib/mcp/context";
import { setPlatform } from "@/app/lib/server/platform";
import { clearAccountTotals } from "@/app/lib/usage/accounts";
import {
  adminGate,
  adminUserIds,
  constantTimeEqual,
  getAdminStats,
  getDailyStats,
  readTokenGate,
  resetStatsReaders,
} from "@/app/lib/usage/admin";
import { USAGE_COLUMNS, USAGE_EVENTS, USAGE_ROUTES, durationBucket, usageRoute } from "@/app/lib/usage/catalog";
import { beaconEvent, postUsage, resetUsageLimits } from "@/app/lib/usage/endpoint";
import { anonymousIds, resetUsageKeys } from "@/app/lib/usage/identity";
import { checkedEvent, usageDataPoint, writeUsageEvent, type UsageDataPoint } from "@/app/lib/usage/record";
import { currentPeriod, memorySaltStorage, SaltStore } from "@/app/lib/usage/salt-store";
import { spikeCheck, summaryDate } from "@/app/lib/usage/stats";
import { trackUsage, usageOptedOut } from "@/app/lib/usage/track";

const WEAPON = "5447a9cd4bdc2dbd208b4567"; // an M4A1's tarkov.dev id
const USER_ID = "user_01JABCDEFGHJKMNPQRSTVWXYZ";
const IP = "203.0.113.77";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) UsageStatsTest/1.0";
const ORIGIN = "http://localhost:3000";
const DAY = 86_400_000;

let written: UsageDataPoint[];
let pending: Promise<unknown>[];

async function flush() {
  while (pending.length) await Promise.all(pending.splice(0));
}

beforeEach(() => {
  written = [];
  pending = [];
  setPlatform({
    writeUsage: (point) => void written.push(point),
    trustedClientIpHeader: "cf-connecting-ip",
    waitUntil: (promise) => void pending.push(promise),
  });
  resetUsageKeys();
  resetUsageLimits();
  resetRequestBudgets();
  resetStatsReaders();
  clearAccountTotals();
});

afterEach(() => {
  setPlatform();
});

/** Every value that could identify someone, which must never appear in a stored row. */
const SECRETS = [USER_ID, IP, USER_AGENT, "UsageStatsTest"];

function expectAnonymous(points: UsageDataPoint[]) {
  const stored = JSON.stringify(points);
  for (const secret of SECRETS) expect(stored).not.toContain(secret);
  for (const point of points) {
    expect(point.blobs).toHaveLength(Object.keys(USAGE_COLUMNS).length);
    expect(Object.keys(point).sort()).toEqual(["blobs", "indexes"]);
  }
}

describe("event validation", () => {
  it("accepts catalogued events with checked fields", () => {
    expect(checkedEvent({ name: "build.optimize", subject: { kind: "weapon", id: WEAPON }, gameMode: "pve", outcome: "ok", duration: "1-5s" })).not.toBeNull();
    expect(checkedEvent({ name: "map.view", subject: { kind: "map", id: "customs" } })).not.toBeNull();
    expect(checkedEvent({ name: "mcp.tool_call", tool: "get_item", subject: { kind: "item", id: WEAPON }, outcome: "crash" })).not.toBeNull();
    expect(checkedEvent({ name: "page.view", route: "/item/$itemName" })).not.toBeNull();
  });

  it("refuses unknown events, fields an event doesn't take, and values outside the closed lists", () => {
    expect(checkedEvent({ name: "made.up" as never })).toBeNull();
    expect(checkedEvent({ name: "group.create", subject: { kind: "map", id: "customs" } })).toBeNull();
    expect(checkedEvent({ name: "map.view", subject: { kind: "weapon", id: WEAPON } })).toBeNull();
    expect(checkedEvent({ name: "map.view", subject: { kind: "map", id: "not-a-map" } })).toBeNull();
    expect(checkedEvent({ name: "build.create", subject: { kind: "weapon", id: "M4A1 with my notes" } })).toBeNull();
    expect(checkedEvent({ name: "mcp.tool_call", tool: "drop_tables" })).toBeNull();
    expect(checkedEvent({ name: "build.optimize", gameMode: "arena" as never })).toBeNull();
    expect(checkedEvent({ name: "build.optimize", outcome: "fine" as never })).toBeNull();
    expect(checkedEvent({ name: "build.optimize", duration: "3s" as never })).toBeNull();
    expect(checkedEvent({ name: "page.view", route: "/item/red-rebel-ice-pick" as never })).toBeNull();
    expect(checkedEvent({ name: "group.create", userId: USER_ID } as never)).toBeNull();
    expect(checkedEvent({ name: "map.view", subject: { kind: "map", id: "customs", note: "x" } as never })).toBeNull();
  });

  it("keeps a two-letter country and drops anything else", () => {
    expect(checkedEvent({ name: "group.create", country: "GB" })?.country).toBe("GB");
    expect(checkedEvent({ name: "group.create", country: "XX" })?.country).toBeUndefined();
    expect(checkedEvent({ name: "group.create", country: "192.0.2.1" })?.country).toBeUndefined();
  });

  it("buckets durations", () => {
    expect([50, 100, 999, 1000, 4999, 5000, 19_999, 20_000, Number.NaN].map(durationBucket)).toEqual([
      "<100ms", "100ms-1s", "100ms-1s", "1-5s", "1-5s", "5-20s", "5-20s", "20s+", "<100ms",
    ]);
  });

  it("names pages by route pattern only", () => {
    expect(usageRoute("/gun-builder/$build/")).toBe("/gun-builder/$build");
    expect(usageRoute("/")).toBe("/");
    expect(usageRoute("/some/new/route")).toBe("other");
  });

  it("lists every route the router has", async () => {
    const tree = await readFile("src/routeTree.gen.ts", "utf8");
    const block = /fullPaths:([\s\S]*?)fileRoutesByTo/.exec(tree)![1];
    const routes = new Set([...block.matchAll(/'([^']+)'/g)].map((match) => usageRoute(match[1]) === "other" ? match[1] : usageRoute(match[1])));
    expect([...routes].sort()).toEqual([...USAGE_ROUTES].sort());
  });
});

describe("beacons", () => {
  it("accepts only website events with their own fields, as short strings", () => {
    expect(beaconEvent({ event: "build.share", subject: WEAPON })).toMatchObject({ name: "build.share", subject: { kind: "weapon", id: WEAPON } });
    expect(beaconEvent({ event: "mcp.tool_call", outcome: "ok" })).toBeNull();
    expect(beaconEvent({ event: "account.sign_in", outcome: "ok" })).toBeNull();
    expect(beaconEvent({ event: "group.create", subject: WEAPON })).toBeNull();
    expect(beaconEvent({ event: "group.create", name: "My loot" })).toBeNull();
    expect(beaconEvent({ event: "group.create", country: "GB" })).toBeNull();
    expect(beaconEvent({ event: "build.share", subject: { kind: "weapon", id: WEAPON } })).toBeNull();
    expect(beaconEvent({ event: "page.view", route: "x".repeat(65) })).toBeNull();
    expect(beaconEvent([{ event: "group.create" }])).toBeNull();
    expect(beaconEvent("group.create")).toBeNull();
  });

  function beacon(body: unknown, headers: Record<string, string> = {}) {
    return new Request(`${ORIGIN}/api/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", "CF-Connecting-IP": IP, "User-Agent": USER_AGENT, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("writes a valid beacon from this site, anonymised", async () => {
    const response = await postUsage(beacon({ event: "build.optimize", subject: WEAPON, gameMode: "regular", outcome: "ok", duration: "1-5s" }));
    expect(response.status).toBe(204);
    await flush();
    expect(written).toHaveLength(1);
    const [point] = written;
    expect(point.indexes).toEqual(["build.optimize"]);
    expect(point.blobs.slice(0, 9)).toEqual(["build.optimize", "web", "gun-builder", "", "weapon", WEAPON, "regular", "ok", "1-5s"]);
    expect(point.blobs[11]).toMatch(/^[0-9a-f]{16}$/);
    expect(point.blobs[12]).toMatch(/^[0-9a-f]{16}$/);
    expect(point.blobs[13]).toBe("0");
    expectAnonymous(written);
  });

  it("refuses other sites, bad bodies and oversized bodies", async () => {
    expect((await postUsage(beacon({ event: "group.create" }, { "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
    expect((await postUsage(beacon("not json"))).status).toBe(400);
    expect((await postUsage(beacon({ event: "group.create", extra: "x" }))).status).toBe(400);
    expect((await postUsage(beacon({ event: "page.view", route: "/" + "a".repeat(600) }))).status).toBe(413);
    await flush();
    expect(written).toHaveLength(0);
  });

  it("drops beacons from browsers that send Global Privacy Control or Do Not Track", async () => {
    expect((await postUsage(beacon({ event: "group.create" }, { "Sec-GPC": "1" }))).status).toBe(204);
    expect((await postUsage(beacon({ event: "group.create" }, { DNT: "1" }))).status).toBe(204);
    await flush();
    expect(written).toHaveLength(0);
  });

  it("rate-limits each client", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 70; index += 1) statuses.push((await postUsage(beacon({ event: "group.create" }))).status);
    expect(statuses.filter((status) => status === 204)).toHaveLength(60);
    expect(statuses.at(-1)).toBe(429);
    // Another client still gets through.
    expect((await postUsage(beacon({ event: "group.create" }, { "CF-Connecting-IP": "198.51.100.1" }))).status).toBe(204);
  });
});

describe("the browser tracker", () => {
  it("treats Global Privacy Control and Do Not Track as opting out", () => {
    expect(usageOptedOut({ globalPrivacyControl: true })).toBe(true);
    expect(usageOptedOut({ doNotTrack: "1" })).toBe(true);
    expect(usageOptedOut({ doNotTrack: "yes" })).toBe(true);
    expect(usageOptedOut({ doNotTrack: "0", globalPrivacyControl: false })).toBe(false);
    expect(usageOptedOut({})).toBe(false);
    // During server rendering there is no navigator, and nothing is sent.
    vi.stubGlobal("navigator", undefined);
    expect(usageOptedOut()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("sends nothing when the visitor opts out, and a beacon otherwise", async () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon, globalPrivacyControl: true });
    trackUsage("group.create");
    expect(sendBeacon).not.toHaveBeenCalled();

    vi.stubGlobal("navigator", { sendBeacon, doNotTrack: "1" });
    trackUsage("group.create");
    expect(sendBeacon).not.toHaveBeenCalled();

    vi.stubGlobal("navigator", { sendBeacon });
    trackUsage("map.view", { subject: "customs" });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("/api/usage");
    expect(JSON.parse(await blob.text())).toEqual({ event: "map.view", subject: "customs" });
    vi.unstubAllGlobals();
  });
});

describe("anonymous daily and weekly ids", () => {
  const TUESDAY = Date.parse("2026-11-24T10:00:00Z");
  const visitor = { ip: IP, userAgent: USER_AGENT };
  const account = { userId: USER_ID, ip: IP, userAgent: USER_AGENT };

  it("names ISO weeks and UTC days", () => {
    expect(currentPeriod("day", TUESDAY)).toEqual({ period: "day:2026-11-24", expiresAt: Date.parse("2026-11-25T00:00:00Z") });
    expect(currentPeriod("week", TUESDAY)).toEqual({ period: "week:2026-W48", expiresAt: Date.parse("2026-11-30T00:00:00Z") });
    expect(currentPeriod("week", Date.parse("2026-01-01T12:00:00Z")).period).toBe("week:2026-W01");
    expect(currentPeriod("week", Date.parse("2027-01-01T12:00:00Z")).period).toBe("week:2026-W53");
    expect(currentPeriod("week", Date.parse("2027-01-04T00:00:00Z")).period).toBe("week:2027-W01");
  });

  it("gives the same subject the same id all day and a new one the next day", async () => {
    const morning = await anonymousIds(visitor, TUESDAY);
    const evening = await anonymousIds(visitor, TUESDAY + 13 * 60 * 60 * 1000);
    const tomorrow = await anonymousIds(visitor, TUESDAY + DAY);
    expect(evening).toEqual(morning);
    expect(tomorrow.day).not.toBe(morning.day);
    // Same ISO week, so the weekly id holds; the next Monday it changes.
    expect(tomorrow.week).toBe(morning.week);
    expect((await anonymousIds(visitor, TUESDAY + 6 * DAY)).week).not.toBe(morning.week);
  });

  it("tells subjects apart, counts an account once wherever it signs in, and marks signed-in ids", async () => {
    const signedOut = await anonymousIds(visitor, TUESDAY);
    const signedIn = await anonymousIds(account, TUESDAY);
    const fromMcp = await anonymousIds({ userId: USER_ID, ip: "198.51.100.9", userAgent: "claude-code" }, TUESDAY);
    const otherBrowser = await anonymousIds({ ip: IP, userAgent: "Other/2.0" }, TUESDAY);
    expect(signedOut.signedIn).toBe("0");
    expect(signedIn.signedIn).toBe("1");
    expect(fromMcp).toEqual(signedIn);
    expect(otherBrowser.day).not.toBe(signedOut.day);
    expect(signedIn.day).not.toBe(signedOut.day);
    expect(await anonymousIds({}, TUESDAY)).toEqual({ day: "", week: "", signedIn: "" });
    expect(await anonymousIds({ ip: "unknown" }, TUESDAY)).toEqual({ day: "", week: "", signedIn: "" });
  });

  it("keeps only the current keys: yesterday's is deleted, so its ids can't be recomputed", async () => {
    const storage = memorySaltStorage();
    const store = new SaltStore(storage);
    resetUsageKeys(store);
    const monday = await anonymousIds(account, TUESDAY - DAY);
    const mondayKey = [...storage.entries].find(([period]) => period === "day:2026-11-23")![1];
    expect(mondayKey).toMatch(/^[0-9a-f]{64}$/);

    await anonymousIds(account, TUESDAY);
    expect([...storage.entries.keys()].sort()).toEqual(["day:2026-11-24", "week:2026-W48"]);
    expect([...storage.entries.values()]).not.toContain(mondayKey);

    // The cleanup the Durable Object's alarm runs deletes the day's key at midnight with no event to trigger it.
    await store.purge(TUESDAY + DAY);
    expect([...storage.entries.keys()]).toEqual(["week:2026-W48"]);
    await store.purge(Date.parse("2026-11-30T00:00:00Z"));
    expect(storage.entries.size).toBe(0);

    // With the key gone, the same subject on the same date hashes to something unrelated.
    resetUsageKeys(new SaltStore(memorySaltStorage()));
    expect((await anonymousIds(account, TUESDAY - DAY)).day).not.toBe(monday.day);
  });

  it("stores a 64-bit keyed hash and nothing it was made from", async () => {
    await writeUsageEvent({ name: "group.create" }, account);
    await writeUsageEvent({ name: "group.create" }, visitor);
    expect(written).toHaveLength(2);
    expectAnonymous(written);
    expect(written.map((point) => point.blobs[13])).toEqual(["1", "0"]);
    // Not a plain hash of the inputs either: those would be the same every day and guessable.
    const plain = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`user:${USER_ID}`));
    const plainHex = Array.from(new Uint8Array(plain, 0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(written[0].blobs[11]).not.toBe(plainHex);
  });
});

describe("server-side events", () => {
  it("records an MCP tool call with the tool, outcome and resolved id, but not who called or what they typed", async () => {
    const context = {
      origin: ORIGIN,
      signal: new AbortController().signal,
      requestId: "test",
      userId: USER_ID,
      usage: { country: "DE", identity: { userId: USER_ID, ip: IP, userAgent: USER_AGENT } },
    };
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runTool(context, { tool: "get_weapon", gameMode: "pve" }, async (_read, noteSubject) => {
      noteSubject({ kind: "weapon", id: WEAPON });
      return { ok: true };
    });
    await runTool(context, { tool: "get_item" }, async (_read, noteSubject) => {
      noteSubject({ kind: "item", id: "my secret search text" });
      throw new Error("boom");
    });
    await flush();
    expect(written).toHaveLength(2);
    expect(written[0].blobs.slice(0, 10)).toEqual(["mcp.tool_call", "mcp", "mcp", "get_weapon", "weapon", WEAPON, "pve", "ok", "<100ms", "DE"]);
    // Text that isn't a tarkov.dev id is dropped; the call itself is still counted.
    expect(written[1].blobs.slice(0, 8)).toEqual(["mcp.tool_call", "mcp", "mcp", "get_item", "", "", "", "crash"]);
    expectAnonymous(written);
    expect(JSON.stringify(written)).not.toContain("secret search");
  });
});

// ---- Admin readers ----

const CLIENT_ID = "client_test";
const API = "https://api.workos.com";
const COOKIE_PASSWORD = "a-test-cookie-password-of-at-least-32-chars";
let signingKey: CryptoKey;
let publicJwk: JWK;
let sqlQueries: string[];

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
});

function workosUser(id: string, createdAt = "2026-11-20T10:00:00.000Z") {
  return {
    object: "user", id, email: `${id}@example.com`, email_verified: true, profile_picture_url: null,
    first_name: null, last_name: null, created_at: createdAt, updated_at: createdAt, last_sign_in_at: null,
    external_id: null, metadata: {},
  };
}

function fakeApis(signedInAs: string) {
  sqlQueries = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    if (url === `${API}/sso/jwks/${CLIENT_ID}`) return Response.json({ keys: [publicJwk] });
    if (url === `${API}/user_management/authenticate` && method === "POST") {
      const token = await new SignJWT({ sid: "session_01" })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setSubject(signedInAs)
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
        .sign(signingKey);
      return Response.json({ user: workosUser(signedInAs), access_token: token, refresh_token: "refresh_01", authentication_method: "Password" });
    }
    if (url.startsWith(`${API}/user_management/users`)) {
      return Response.json({ object: "list", data: [workosUser("user_A", "2026-11-23T08:00:00.000Z"), workosUser("user_B")], list_metadata: { before: null, after: null } });
    }
    if (url.includes("/analytics_engine/sql")) {
      sqlQueries.push(String(init?.body));
      return Response.json({ meta: [], data: [], rows: 0 });
    }
    return new Response("unexpected", { status: 500 });
  });
}

function enableAccounts() {
  vi.stubEnv("WORKOS_API_KEY", "sk_test_key");
  vi.stubEnv("WORKOS_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("WORKOS_COOKIE_PASSWORD", COOKIE_PASSWORD);
  vi.stubEnv("STATS_CF_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
  vi.stubEnv("STATS_CF_API_TOKEN", "test-token");
}

function cookieOf(response: Response, name: string) {
  const header = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`))!;
  return decodeURIComponent(header.split(";")[0].slice(name.length + 1));
}

async function sessionFor(userId: string) {
  fakeApis(userId);
  const started = await signIn(new Request(`${ORIGIN}/auth/sign-in`));
  // The state cookie is sealed; AuthKit gets the plain state in the redirect URL.
  const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
  const sealed = cookieOf(started, STATE_COOKIE);
  const finished = await authCallback(
    new Request(`${ORIGIN}/auth/callback?code=code_01&state=${state}`, { headers: { cookie: `${STATE_COOKIE}=${encodeURIComponent(sealed)}` } })
  );
  return cookieOf(finished, SESSION_COOKIE);
}

function statsRequest(path: string, session?: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, { headers: { ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}), ...headers } });
}

describe("the admin dashboard gate", () => {
  beforeEach(() => {
    enableAccounts();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("reads the allowlist of WorkOS user ids", () => {
    expect([...adminUserIds({ STATS_ADMIN_USER_IDS: `${USER_ID}, user_02ABCDEFGHJK  not-an-id` } as unknown as NodeJS.ProcessEnv)]).toEqual([USER_ID, "user_02ABCDEFGHJK"]);
    expect(adminUserIds({} as unknown as NodeJS.ProcessEnv).size).toBe(0);
  });

  it("is off when no admin is listed", async () => {
    vi.stubEnv("STATS_ADMIN_USER_IDS", "");
    const session = await sessionFor(USER_ID);
    expect((await adminGate(statsRequest("/api/admin/stats", session))).kind).toBe("off");
    expect((await getAdminStats(statsRequest("/api/admin/stats", session))).status).toBe(404);
  });

  it("asks signed-out visitors to sign in and refuses accounts not on the list", async () => {
    vi.stubEnv("STATS_ADMIN_USER_IDS", USER_ID);
    expect((await getAdminStats(statsRequest("/api/admin/stats"))).status).toBe(401);
    const other = await sessionFor("user_99ZZZZZZZZZZZZ");
    expect((await getAdminStats(statsRequest("/api/admin/stats", other))).status).toBe(403);
    expect(sqlQueries).toHaveLength(0);
  });

  it("lets a listed admin read the stats, which queries the SQL API server-side", async () => {
    vi.stubEnv("STATS_ADMIN_USER_IDS", USER_ID);
    const session = await sessionFor(USER_ID);
    const response = await getAdminStats(statsRequest("/api/admin/stats?days=30", session));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ range: 30, totals: { events: 0 }, accounts: { total: 2 } });
    expect(sqlQueries.length).toBeGreaterThan(5);
    expect(sqlQueries.every((query) => query.includes("FROM eft_toolset_usage") && query.endsWith("FORMAT JSON"))).toBe(true);
    expect(sqlQueries.some((query) => query.includes("INTERVAL '30' DAY"))).toBe(true);
    expect((await getAdminStats(statsRequest("/api/admin/stats?days=31", session))).status).toBe(400);
  });

  it("counts a signed-in browser's beacons as its account, without storing the id", async () => {
    const session = await sessionFor(USER_ID);
    await flush();
    written.length = 0;
    const beacon = (cookie: string) =>
      postUsage(
        new Request(`${ORIGIN}/api/usage`, {
          method: "POST",
          headers: { "Sec-Fetch-Site": "same-origin", "CF-Connecting-IP": IP, "User-Agent": USER_AGENT, cookie },
          body: JSON.stringify({ event: "group.create" }),
        })
      );
    expect((await beacon(`${SESSION_COOKIE}=${session}`)).status).toBe(204);
    expect((await beacon(`${SESSION_COOKIE}=not-a-sealed-session`)).status).toBe(204);
    await flush();
    expect(written.map((point) => point.blobs[13])).toEqual(["1", "0"]);
    expect(written[0].blobs[11]).toBe((await anonymousIds({ userId: USER_ID })).day);
    expectAnonymous(written);
  });

  it("records sign-ins anonymously", async () => {
    await sessionFor(USER_ID);
    await flush();
    const signIns = written.filter((point) => point.indexes[0] === "account.sign_in");
    expect(signIns).toHaveLength(1);
    expect(signIns[0].blobs[7]).toBe("ok");
    expect(signIns[0].blobs[13]).toBe("1");
    expectAnonymous(written);
  });
});

describe("the daily summary", () => {
  const TOKEN = "s".repeat(40);

  beforeEach(() => {
    enableAccounts();
    fakeApis(USER_ID);
  });

  it("checks the bearer token in constant time and is off without one", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
    const env = { STATS_READ_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv;
    expect(readTokenGate(statsRequest("/", undefined, { Authorization: `Bearer ${TOKEN}` }), env)).toBe("ok");
    expect(readTokenGate(statsRequest("/", undefined, { Authorization: `Bearer ${TOKEN}x` }), env)).toBe("denied");
    expect(readTokenGate(statsRequest("/"), env)).toBe("denied");
    expect(readTokenGate(statsRequest("/", undefined, { Authorization: "Bearer short" }), { STATS_READ_TOKEN: "short" } as unknown as NodeJS.ProcessEnv)).toBe("off");
  });

  it("answers with the day's summary for the token holder only", async () => {
    vi.stubEnv("STATS_READ_TOKEN", "");
    expect((await getDailyStats(statsRequest("/api/admin/stats/daily"))).status).toBe(404);
    vi.stubEnv("STATS_READ_TOKEN", TOKEN);
    const denied = await getDailyStats(statsRequest("/api/admin/stats/daily"));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("Bearer");

    const date = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    const response = await getDailyStats(statsRequest(`/api/admin/stats/daily?date=${date}`, undefined, { Authorization: `Bearer ${TOKEN}` }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ date, visitors: { total: 0 }, pageViews: 0, accounts: { total: 2 }, spikes: { events: { spike: false } } });
    expect(Object.keys(body.spikes).sort()).toEqual(["errors", "events", "mcpCalls", "pageViews", "visitors"]);
    expect(sqlQueries.some((query) => query.includes(`toDateTime('${date} 00:00:00')`))).toBe(true);

    const bad = await getDailyStats(statsRequest("/api/admin/stats/daily?date=2026-02-30", undefined, { Authorization: `Bearer ${TOKEN}` }));
    expect(bad.status).toBe(400);
  });

  it("rate-limits readers", async () => {
    vi.stubEnv("STATS_READ_TOKEN", TOKEN);
    const statuses: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      statuses.push((await getDailyStats(statsRequest("/api/admin/stats/daily", undefined, { "CF-Connecting-IP": IP }))).status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("checks dates and flags spikes against the week before", () => {
    const now = Date.parse("2026-11-24T12:00:00Z");
    expect(summaryDate("2026-11-23", now)).toBe("2026-11-23");
    expect(summaryDate("2026-11-25", now)).toBeNull();
    expect(summaryDate("2026-02-30", now)).toBeNull();
    expect(summaryDate("2026-01-01", now)).toBeNull();
    expect(summaryDate("2026-11-23'; DROP", now)).toBeNull();
    expect(spikeCheck(100, [40, 40, 40, 40, 40, 40, 40])).toMatchObject({ spike: true, average7d: 40, ratio: 2.5 });
    expect(spikeCheck(70, [40, 40, 40, 40, 40, 40, 40]).spike).toBe(false);
    expect(spikeCheck(10, [1, 1, 1, 1, 1, 1, 1]).spike).toBe(false);
    expect(spikeCheck(25, [0, 0, 0, 0, 0, 0, 0])).toMatchObject({ spike: true, ratio: null });
  });
});

describe("the catalogue", () => {
  it("gives every event a feature and a source", () => {
    for (const spec of Object.values(USAGE_EVENTS)) {
      expect(spec.feature).toMatch(/^[a-z-]+$/);
      expect(["web", "mcp", "server"]).toContain(spec.source);
    }
  });

  it("writes rows in column order with nothing beyond the catalogue", () => {
    const point = usageDataPoint({ name: "page.view", route: "/mcp", country: "GB" }, { day: "a".repeat(16), week: "b".repeat(16), signedIn: "0" });
    const columns = Object.fromEntries(Object.entries(USAGE_COLUMNS).map(([name, column]) => [name, point.blobs[Number(column.slice(4)) - 1]]));
    expect(columns).toEqual({
      event: "page.view", source: "web", feature: "site", tool: "", subjectKind: "", subject: "", gameMode: "", outcome: "",
      duration: "", country: "GB", version: "1", anonDay: "a".repeat(16), anonWeek: "b".repeat(16), signedIn: "0", route: "/mcp",
    });
  });
});
