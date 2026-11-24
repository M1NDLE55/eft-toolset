import { SESSION_COOKIE, STATE_COOKIE } from "./cookies";
import { safeReturnPath } from "@/app/lib/sharing/return-path";
import {
  accountConfig,
  accountRateLimited,
  accountUser,
  appOrigin,
  callbackUrl,
  isSameOriginRequest,
  readSession,
  setSessionCookies,
  workosClient,
} from "./server";
import { readCookie, setCookie } from "@/app/lib/server/cookies";
import { accountCacheKey } from "@/app/lib/sharing/server/secrets";
import { DEV_USER_COOKIE, devAuthEnabled, devUserId } from "@/app/lib/sharing/server/session";
import { SIGNED_IN_COOKIE } from "./cookies";

// The website account routes. Only these touch sessions, so every page stays cacheable and never
// reads cookies. See DATA_ARCHITECTURE.md ("Website accounts").

const NO_STORE = { "Cache-Control": "no-store" };
const STATE_MAX_AGE_SECONDS = 10 * 60;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function redirect(url: string | URL, status = 303) {
  return new Response(null, { status, headers: { Location: String(url) } });
}

/** GET /auth/sign-in: starts AuthKit's hosted sign-in, or sign-up with ?screen=sign-up. */
export async function signIn(request: Request) {
  const config = accountConfig();
  const settings = new URL("/settings#account", appOrigin(request));
  if (!config) return redirect(settings);
  if ((await accountRateLimited(request)) !== null) return redirect(new URL("/settings?account=busy#account", settings));

  const state = crypto.randomUUID();
  const screenHint = new URL(request.url).searchParams.get("screen") === "sign-up" ? "sign-up" : "sign-in";
  const url = workosClient(config).userManagement.getAuthorizationUrl({
    provider: "authkit",
    clientId: config.clientId,
    redirectUri: callbackUrl(request),
    state,
    screenHint,
  });
  const response = redirect(url);
  setCookie(response.headers, STATE_COOKIE, state, {
    path: "/auth/callback",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return response;
}

/** GET /auth/callback: AuthKit sends the user back here with a code, which becomes the session cookie. */
export async function authCallback(request: Request) {
  const config = accountConfig();
  const origin = appOrigin(request);
  const done = (outcome: "signed-in" | "error" | "busy") => {
    const response = redirect(new URL(`/settings?account=${outcome}#account`, origin));
    setCookie(response.headers, STATE_COOKIE, "", { path: "/auth/callback", maxAge: 0 });
    return response;
  };
  if (!config) return done("error");
  if ((await accountRateLimited(request)) !== null) return done("busy");

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const expected = readCookie(request, STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) return done("error");

  try {
    const auth = await workosClient(config).userManagement.authenticateWithCode({
      clientId: config.clientId,
      code,
      session: { sealSession: true, cookiePassword: config.cookiePassword },
    });
    if (!auth.sealedSession) throw new Error("WorkOS returned no sealed session.");
    return setSessionCookies(done("signed-in"), auth.sealedSession);
  } catch (error) {
    console.error("Sign-in could not be completed", error);
    return done("error");
  }
}

/** GET /api/account: the signed-in user, or null. configured is false when accounts are off on this server. */
export async function getAccount(request: Request) {
  const devUser = devUserId(readCookie(request, DEV_USER_COOKIE));
  if (devUser) {
    const name = devUser.slice("user_dev_".length);
    return json({ configured: true, user: { email: `${name}@dev.local`, name, createdAt: new Date(0).toISOString() }, cacheKey: await accountCacheKey(devUser) });
  }
  const config = accountConfig();
  if (!config) return json({ configured: false, user: null });
  const retryAfter = await accountRateLimited(request);
  if (retryAfter !== null) return json({ error: "Too many requests." }, 429, { "Retry-After": String(retryAfter) });

  const session = await readSession(readCookie(request, SESSION_COOKIE), config);
  if (session.kind === "unavailable") return json({ error: "Your account can't be checked right now." }, 503);
  if (session.kind === "signed_out") return setSessionCookies(json({ configured: true, user: null }), null);
  const response = json({ configured: true, user: accountUser(session.user), cacheKey: await accountCacheKey(session.userId) });
  return session.sealedSession ? setSessionCookies(response, session.sealedSession) : response;
}

/** DELETE /api/account: deletes the signed-in user from WorkOS, which also ends their AI assistants' access. */
export async function deleteAccount(request: Request) {
  const config = accountConfig();
  if (!config) return json({ error: "Accounts are off." }, 404);
  if (!isSameOriginRequest(request)) return json({ error: "Forbidden." }, 403);
  const retryAfter = await accountRateLimited(request);
  if (retryAfter !== null) return json({ error: "Too many requests." }, 429, { "Retry-After": String(retryAfter) });

  const session = await readSession(readCookie(request, SESSION_COOKIE), config);
  if (session.kind === "unavailable") return json({ error: "Your account can't be checked right now." }, 503);
  if (session.kind === "signed_out") return setSessionCookies(json({ error: "You're not signed in." }, 401), null);
  try {
    await workosClient(config).userManagement.deleteUser(session.userId);
  } catch (error) {
    console.error("Account could not be deleted", error);
    return json({ error: "Your account couldn't be deleted. Try again." }, 502);
  }
  return setSessionCookies(json({ deleted: true }), null);
}

/**
 * POST /api/account/sign-out: clears the session cookies and returns where to go next: AuthKit's
 * logout URL, which ends the WorkOS session too, or the settings page when there is no session.
 * JSON rather than a redirect, because the site's form-action policy blocks a form that
 * redirects to another origin.
 */
export async function signOut(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "Forbidden." }, 403);
  const settings = new URL("/settings#account", appOrigin(request)).href;
  const config = accountConfig();
  if (!config) return setSessionCookies(json({ url: settings }), null);
  const retryAfter = await accountRateLimited(request);
  if (retryAfter !== null) return json({ error: "Too many requests." }, 429, { "Retry-After": String(retryAfter) });

  const session = await readSession(readCookie(request, SESSION_COOKIE), config);
  let url = settings;
  if (session.kind === "signed_in") {
    url = workosClient(config).userManagement.getLogoutUrl({ sessionId: session.sessionId, returnTo: settings });
  }
  return setSessionCookies(json({ url }), null);
}

/**
 * GET /auth/dev-sign-in?user=<name>&return=<path>: development only (DEV_AUTH=1 in .dev.vars, and
 * never in a production build). Signs this browser in as a local test user, so live hosting can be
 * tried with two browsers without WorkOS. ?user= with no name signs out.
 */
export async function devSignIn(request: Request) {
  if (!devAuthEnabled()) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const name = url.searchParams.get("user") ?? "";
  const response = redirect(new URL(safeReturnPath(url.searchParams.get("return")), url.origin));
  const valid = devUserId(name) !== null;
  setCookie(response.headers, DEV_USER_COOKIE, valid ? name : "", { path: "/", sameSite: "lax", httpOnly: true, maxAge: valid ? 86_400 : 0 });
  setCookie(response.headers, SIGNED_IN_COOKIE, valid ? "1" : "", { path: "/", sameSite: "lax", maxAge: valid ? 86_400 : 0 });
  return response;
}
