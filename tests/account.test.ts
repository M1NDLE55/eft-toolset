// @vitest-environment node
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authCallback as callback, deleteAccount, getAccount, signIn, signOut } from "@/app/lib/account/routes";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { SESSION_COOKIE, SIGNED_IN_COOKIE, STATE_COOKIE } from "@/app/lib/account/cookies";

const CLIENT_ID = "client_test";
const API = "https://api.workos.com";
const COOKIE_PASSWORD = "a-test-cookie-password-of-at-least-32-chars";

let signingKey: CryptoKey;
let publicJwk: JWK;
let workosCalls: { method: string; url: string; body: unknown }[];
let accessTokenExpiry: number;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
});

function accessToken() {
  return new SignJWT({ sid: "session_01" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setSubject("user_01")
    .setIssuedAt()
    .setExpirationTime(accessTokenExpiry)
    .sign(signingKey);
}

const USER = {
  object: "user",
  id: "user_01",
  email: "player@example.com",
  email_verified: true,
  profile_picture_url: null,
  first_name: "Tarkov",
  last_name: "Player",
  created_at: "2026-01-02T03:04:05.000Z",
  updated_at: "2026-01-02T03:04:05.000Z",
  last_sign_in_at: null,
  external_id: null,
  metadata: {},
};

async function workosApi(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  workosCalls.push({ method, url, body });
  if (url === `${API}/sso/jwks/${CLIENT_ID}`) return Response.json({ keys: [publicJwk] });
  if (url === `${API}/user_management/authenticate` && method === "POST") {
    if (body?.grant_type === "refresh_token") accessTokenExpiry = Math.floor(Date.now() / 1000) + 300;
    return Response.json({
      user: USER,
      access_token: await accessToken(),
      refresh_token: "refresh_01",
      authentication_method: "Password",
    });
  }
  if (url === `${API}/user_management/users/user_01` && method === "DELETE") return new Response(null, { status: 204 });
  return new Response("unexpected", { status: 500 });
}

function enableAccounts() {
  vi.stubEnv("WORKOS_API_KEY", "sk_test_key");
  vi.stubEnv("WORKOS_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("WORKOS_COOKIE_PASSWORD", COOKIE_PASSWORD);
}

function request(path: string, init: { method?: string; cookies?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const cookie = Object.entries(init.cookies ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new Request(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: { ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

interface SetCookie {
  value: string;
  path?: string;
  httpOnly?: boolean;
  sameSite?: string;
  maxAge?: number;
}

/** The response's Set-Cookie headers by name, read as a browser would. */
function setCookies(response: Response) {
  const parsed = new Map<string, SetCookie>();
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(";").map((part) => part.trim());
    const index = pair.indexOf("=");
    const cookie: SetCookie = { value: decodeURIComponent(pair.slice(index + 1)) };
    for (const attribute of attributes) {
      const [key, value] = attribute.split("=");
      if (/^path$/i.test(key)) cookie.path = value;
      if (/^httponly$/i.test(key)) cookie.httpOnly = true;
      if (/^samesite$/i.test(key)) cookie.sameSite = value.toLowerCase();
      if (/^max-age$/i.test(key)) cookie.maxAge = Number(value);
    }
    parsed.set(pair.slice(0, index), cookie);
  }
  return { get: (name: string) => parsed.get(name) };
}

/** Signs in through the routes and returns the session cookie value. */
async function signedInSession() {
  const started = await signIn(request("/auth/sign-in"));
  const state = setCookies(started).get(STATE_COOKIE)!.value;
  const finished = await callback(request(`/auth/callback?code=code_01&state=${state}`, { cookies: { [STATE_COOKIE]: state } }));
  return setCookies(finished).get(SESSION_COOKIE)!.value;
}

beforeEach(() => {
  resetRequestBudgets();
  workosCalls = [];
  accessTokenExpiry = Math.floor(Date.now() / 1000) + 300;
  vi.stubEnv("WORKOS_API_KEY", "");
  vi.stubEnv("WORKOS_CLIENT_ID", "");
  vi.stubEnv("WORKOS_COOKIE_PASSWORD", "");
  vi.spyOn(globalThis, "fetch").mockImplementation(workosApi);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("accounts off", () => {
  it("reports accounts as off and sends sign-in back to settings", async () => {
    expect(await (await getAccount(request("/api/account"))).json()).toEqual({ configured: false, user: null });
    const response = await signIn(request("/auth/sign-in"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/settings#account");
  });

  it("stays off with a cookie password shorter than 32 characters", async () => {
    enableAccounts();
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "short");
    expect(await (await getAccount(request("/api/account"))).json()).toEqual({ configured: false, user: null });
  });
});

describe("accounts on", () => {
  beforeEach(enableAccounts);

  it("starts AuthKit sign-in with a state cookie scoped to the callback", async () => {
    const response = await signIn(request("/auth/sign-in?screen=sign-up"));
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(`${API}/user_management/authorize`);
    expect(location.searchParams.get("provider")).toBe("authkit");
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/callback");
    expect(location.searchParams.get("screen_hint")).toBe("sign-up");
    const state = setCookies(response).get(STATE_COOKIE)!;
    expect(location.searchParams.get("state")).toBe(state.value);
    expect(state).toMatchObject({ httpOnly: true, path: "/auth/callback", sameSite: "lax" });
  });

  it("returns production sign-ins to the canonical site, or to APP_ORIGIN when a deployment sets it", async () => {
    const redirectUri = async (url: string) =>
      new URL((await signIn(new Request(url))).headers.get("location")!).searchParams.get("redirect_uri");
    vi.stubEnv("NODE_ENV", "production");
    expect(await redirectUri("https://eft-toolset.example.workers.dev/auth/sign-in")).toBe("https://www.eft-toolset.com/auth/callback");
    vi.stubEnv("APP_ORIGIN", "https://eft-toolset.example.workers.dev");
    expect(await redirectUri("https://eft-toolset.example.workers.dev/auth/sign-in")).toBe(
      "https://eft-toolset.example.workers.dev/auth/callback"
    );
    vi.stubEnv("APP_ORIGIN", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(await redirectUri("http://localhost:5173/auth/sign-in")).toBe("http://localhost:5173/auth/callback");
  });

  it("refuses a callback whose state doesn't match the cookie", async () => {
    for (const cookies of [{}, { [STATE_COOKIE]: "other" }] as Record<string, string>[]) {
      const response = await callback(request("/auth/callback?code=code_01&state=mine", { cookies }));
      expect(response.headers.get("location")).toBe("http://localhost:3000/settings?account=error#account");
      expect(setCookies(response).get(SESSION_COOKIE)).toBeUndefined();
    }
    expect(workosCalls.filter((call) => call.url.endsWith("/authenticate"))).toHaveLength(0);
  });

  it("signs in: seals the session in an httpOnly cookie, sets the readable hint, and shows the account", async () => {
    const started = await signIn(request("/auth/sign-in"));
    const state = setCookies(started).get(STATE_COOKIE)!.value;
    const finished = await callback(request(`/auth/callback?code=code_01&state=${state}`, { cookies: { [STATE_COOKIE]: state } }));
    expect(finished.headers.get("location")).toBe("http://localhost:3000/settings?account=signed-in#account");
    const session = setCookies(finished).get(SESSION_COOKIE)!;
    expect(session).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(session.value).not.toContain("refresh_01");
    const hint = setCookies(finished).get(SIGNED_IN_COOKIE)!;
    expect(hint.value).toBe("1");
    expect(hint.httpOnly).not.toBe(true);
    expect(workosCalls.find((call) => call.url.endsWith("/authenticate"))?.body).toMatchObject({
      client_id: CLIENT_ID,
      client_secret: "sk_test_key",
      grant_type: "authorization_code",
      code: "code_01",
    });

    const account = await getAccount(request("/api/account", { cookies: { [SESSION_COOKIE]: session.value } }));
    expect(account.headers.get("cache-control")).toBe("no-store");
    expect(await account.json()).toEqual({
      configured: true,
      user: { email: "player@example.com", name: "Tarkov Player", createdAt: "2026-01-02T03:04:05.000Z" },
      // Names the browser's account cache without revealing the WorkOS user id.
      cacheKey: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/),
    });
  });

  it("refreshes an expired access token and rewrites the cookie", async () => {
    accessTokenExpiry = Math.floor(Date.now() / 1000) - 60;
    const session = await signedInSession();
    const account = await getAccount(request("/api/account", { cookies: { [SESSION_COOKIE]: session } }));
    expect((await account.json()).user.email).toBe("player@example.com");
    expect(workosCalls.some((call) => (call.body as { grant_type?: string } | null)?.grant_type === "refresh_token")).toBe(true);
    const rewritten = setCookies(account).get(SESSION_COOKIE)!.value;
    expect(rewritten).not.toBe(session);
  });

  it("clears the cookies when the session cookie can't be read", async () => {
    const account = await getAccount(request("/api/account", { cookies: { [SESSION_COOKIE]: "tampered", [SIGNED_IN_COOKIE]: "1" } }));
    expect(await account.json()).toEqual({ configured: true, user: null });
    expect(setCookies(account).get(SESSION_COOKIE)?.value).toBe("");
    expect(setCookies(account).get(SIGNED_IN_COOKIE)?.value).toBe("");
  });

  it("signs out with AuthKit's logout URL and clears the cookies", async () => {
    const session = await signedInSession();
    const response = await signOut(
      request("/api/account/sign-out", { method: "POST", cookies: { [SESSION_COOKIE]: session }, headers: { "Sec-Fetch-Site": "same-origin" } })
    );
    const { url } = await response.json();
    const logout = new URL(url);
    expect(logout.origin + logout.pathname).toBe(`${API}/user_management/sessions/logout`);
    expect(logout.searchParams.get("session_id")).toBe("session_01");
    expect(logout.searchParams.get("return_to")).toBe("http://localhost:3000/settings#account");
    expect(setCookies(response).get(SESSION_COOKIE)?.value).toBe("");
  });

  it("deletes the signed-in user, but only for requests from this site", async () => {
    const session = await signedInSession();
    for (const headers of [{ "Sec-Fetch-Site": "cross-site" }, { Origin: "https://evil.example" }, {} as Record<string, string>]) {
      const refused = await deleteAccount(request("/api/account", { method: "DELETE", cookies: { [SESSION_COOKIE]: session }, headers }));
      expect(refused.status).toBe(403);
    }
    expect(workosCalls.some((call) => call.method === "DELETE")).toBe(false);

    const deleted = await deleteAccount(
      request("/api/account", { method: "DELETE", cookies: { [SESSION_COOKIE]: session }, headers: { "Sec-Fetch-Site": "same-origin" } })
    );
    expect(await deleted.json()).toEqual({ deleted: true });
    expect(workosCalls.filter((call) => call.method === "DELETE").map((call) => call.url)).toEqual([`${API}/user_management/users/user_01`]);
    expect(setCookies(deleted).get(SESSION_COOKIE)?.value).toBe("");
  });

  it("refuses to delete without a session", async () => {
    const response = await deleteAccount(request("/api/account", { method: "DELETE", headers: { Origin: "http://localhost:3000" } }));
    expect(response.status).toBe(401);
    expect(workosCalls).toHaveLength(0);
  });
});
