import { WorkOS, type User } from "@workos-inc/node";
import { consumeRequestBudget, crossIsolateLimit } from "@/app/lib/api/rate-limit";
import { setCookie } from "@/app/lib/server/cookies";
import { SITE_ORIGIN } from "@/app/lib/site";
import { SESSION_COOKIE, SIGNED_IN_COOKIE } from "./cookies";

/**
 * Website accounts, signed in through the same WorkOS AuthKit environment as the MCP
 * endpoint, so a user's id is the same in both. Off unless all three settings are set.
 */
export interface AccountConfig {
  apiKey: string;
  clientId: string;
  cookiePassword: string;
}

const MIN_COOKIE_PASSWORD_LENGTH = 32;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

let cachedClient: { key: string; workos: WorkOS } | undefined;

export function accountConfig(): AccountConfig | null {
  const apiKey = process.env.WORKOS_API_KEY?.trim() ?? "";
  const clientId = process.env.WORKOS_CLIENT_ID?.trim() ?? "";
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD?.trim() ?? "";
  if (!apiKey || !clientId || !cookiePassword) return null;
  if (cookiePassword.length < MIN_COOKIE_PASSWORD_LENGTH) {
    console.error(`Accounts are off: WORKOS_COOKIE_PASSWORD must be at least ${MIN_COOKIE_PASSWORD_LENGTH} characters.`);
    return null;
  }
  return { apiKey, clientId, cookiePassword };
}

export function workosClient(config: AccountConfig) {
  const key = `${config.apiKey}\n${config.clientId}`;
  if (cachedClient?.key !== key) {
    // Looks fetch up per call rather than once, so it can be stubbed in tests.
    const fetchFn: typeof fetch = (input, init) => fetch(input, init);
    cachedClient = { key, workos: new WorkOS(config.apiKey, { clientId: config.clientId, fetchFn }) };
  }
  return cachedClient.workos;
}

/**
 * Where sign-in sends users back to. A production build uses the canonical site, so request
 * headers never choose where users land. Development runs on localhost and uses the request's
 * own origin. A deployment on another hostname (a preview, or the workers.dev URL before
 * cutover) sets APP_ORIGIN to its own origin, which must also be a WorkOS redirect URI.
 */
export function appOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  return process.env.NODE_ENV === "production" ? SITE_ORIGIN : new URL(request.url).origin;
}

export function callbackUrl(request: Request) {
  return `${appOrigin(request)}/auth/callback`;
}

/** The account details the settings page shows. The WorkOS user id stays on the server. */
export interface AccountUser {
  email: string;
  name: string | null;
  createdAt: string;
}

export function accountUser(user: User): AccountUser {
  const name = user.name ?? ([user.firstName, user.lastName].filter(Boolean).join(" ") || null);
  return { email: user.email, name, createdAt: new Date(user.createdAt).toISOString() };
}

export type SessionState =
  | { kind: "signed_out" }
  /** sealedSession is set when the session was refreshed and the cookie must be rewritten. */
  | { kind: "signed_in"; userId: string; sessionId: string; user: User; sealedSession?: string }
  /** WorkOS couldn't be reached to refresh the session; it may still be valid. */
  | { kind: "unavailable" };

/** Reads the session cookie, refreshing an expired access token once. */
export async function readSession(sessionData: string | undefined, config: AccountConfig): Promise<SessionState> {
  if (!sessionData) return { kind: "signed_out" };
  const workos = workosClient(config);
  try {
    const session = workos.userManagement.loadSealedSession({ sessionData, cookiePassword: config.cookiePassword });
    const current = await session.authenticate();
    if (current.authenticated) {
      return { kind: "signed_in", userId: current.user.id, sessionId: current.sessionId, user: current.user };
    }
    if (current.reason !== "invalid_jwt") return { kind: "signed_out" };
    const refreshed = await session.refresh({ cookiePassword: config.cookiePassword });
    if (!refreshed.authenticated) return refreshed.retryable ? { kind: "unavailable" } : { kind: "signed_out" };
    return {
      kind: "signed_in",
      userId: refreshed.user.id,
      sessionId: refreshed.sessionId,
      user: refreshed.user,
      sealedSession: refreshed.sealedSession,
    };
  } catch (error) {
    console.error("Account session could not be read", error);
    return { kind: "unavailable" };
  }
}

/** Writes the session and its hint, or clears both when sealedSession is null. */
export function setSessionCookies(response: Response, sealedSession: string | null) {
  const secure = process.env.NODE_ENV === "production";
  const base = { path: "/", sameSite: "lax" as const, secure };
  if (sealedSession === null) {
    setCookie(response.headers, SESSION_COOKIE, "", { ...base, httpOnly: true, maxAge: 0 });
    setCookie(response.headers, SIGNED_IN_COOKIE, "", { ...base, maxAge: 0 });
    return response;
  }
  setCookie(response.headers, SESSION_COOKIE, sealedSession, { ...base, httpOnly: true, maxAge: SESSION_MAX_AGE_SECONDS });
  setCookie(response.headers, SIGNED_IN_COOKIE, "1", { ...base, maxAge: SESSION_MAX_AGE_SECONDS });
  return response;
}

/**
 * Requests that change the account must come from this site's own pages. Browsers send
 * Sec-Fetch-Site; the Origin check covers those that don't.
 */
export function isSameOriginRequest(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && (origin === new URL(request.url).origin || origin === appOrigin(request));
}

/** Account routes share the website's per-client budget, which keeps WorkOS calls bounded. */
export async function accountRateLimited(request: Request) {
  const budget = (await crossIsolateLimit(request, "web")) ?? consumeRequestBudget(request);
  return budget.allowed ? null : budget.retryAfterSeconds;
}
