import { SESSION_COOKIE, STATE_COOKIE } from "./cookies";
import { DEFAULT_RETURN_PATH, safeReturnPath } from "@/app/lib/sharing/return-path";
import { sealState, unsealState, type SignInIntent, type SignInState } from "./sealed-state";
import { verifyLinkCode } from "@/app/lib/sharing/link-code";
import { finishIntent } from "@/app/lib/sharing/server/intents";
import { runAccountDeletion } from "@/app/lib/sharing/server/account-deletion";
import { platform } from "@/app/lib/server/platform";
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
import { accountCacheKey, linkKeys } from "@/app/lib/sharing/server/secrets";
import { DEV_USER_COOKIE, devAuthEnabled, devUserId } from "@/app/lib/sharing/server/session";
import { SIGNED_IN_COOKIE } from "./cookies";
import { clientIp } from "@/app/lib/api/rate-limit";
import { recordUsage, requestCountry, requestIdentity } from "@/app/lib/usage/record";

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

/** The sealing key for the sign-in state cookie; a fixed key stands in for local development. */
function statePassword() {
  return accountConfig()?.cookiePassword ?? (devAuthEnabled() ? "development-only-state-key-not-secret-00000" : null);
}

async function startSignIn(request: Request, details: { intent?: SignInIntent; returnPath?: string; screen: "sign-in" | "sign-up" }) {
  const config = accountConfig();
  const password = statePassword();
  if (!password) return null;
  const state = crypto.randomUUID();
  const sealed = await sealState({ state, ...details, expiresAt: Date.now() + STATE_MAX_AGE_SECONDS * 1000 }, password);
  // Without WorkOS (local development with DEV_AUTH=1), a small page stands in for AuthKit.
  const url = config
    ? workosClient(config).userManagement.getAuthorizationUrl({
        provider: "authkit",
        clientId: config.clientId,
        redirectUri: callbackUrl(request),
        state,
        screenHint: details.screen,
      })
    : `${appOrigin(request)}/auth/dev-sign-in?state=${encodeURIComponent(state)}`;
  return { url, sealed };
}

function setStateCookie(headers: Headers, sealed: string) {
  setCookie(headers, STATE_COOKIE, sealed, {
    path: "/auth/callback",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
}

/**
 * GET /auth/sign-in: starts AuthKit's hosted sign-in, or sign-up with ?screen=sign-up. ?return=<path>
 * brings the visitor back to an allowlisted page afterwards (§15); anything else falls back to Settings.
 */
export async function signIn(request: Request) {
  const settings = new URL("/settings#account", appOrigin(request));
  if (!accountConfig() && !devAuthEnabled()) return redirect(settings);
  if ((await accountRateLimited(request)) !== null) return redirect(new URL("/settings?account=busy#account", settings));
  const params = new URL(request.url).searchParams;
  const started = await startSignIn(request, {
    screen: params.get("screen") === "sign-up" ? "sign-up" : "sign-in",
    ...(params.has("return") ? { returnPath: safeReturnPath(params.get("return")) } : {}),
  });
  if (!started) return redirect(settings);
  const response = redirect(started.url);
  setStateCookie(response.headers, started.sealed);
  return response;
}

/**
 * POST /auth/sign-in: { intent: 'copy' | 'join', code, screen? } from our own pages only, so no
 * other site can set an intent for a visitor. The code travels in the body and the sealed cookie,
 * never in a URL. Answers with the URL to go to (a form can't redirect to AuthKit under the site's
 * form-action policy, as with sign-out).
 */
export async function signInWithIntent(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: { code: "forbidden", message: "Forbidden." } }, 403);
  if (!accountConfig() && !devAuthEnabled()) return json({ error: { code: "forbidden", message: "Accounts are off." } }, 404);
  const retryAfter = await accountRateLimited(request);
  if (retryAfter !== null) return json({ error: { code: "rate_limited", message: "Too many requests." } }, 429, { "Retry-After": String(retryAfter) });
  let body: { intent?: unknown; code?: unknown; screen?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: { code: "invalid", message: "Send JSON." } }, 400);
  }
  if ((body.intent !== "copy" && body.intent !== "join") || typeof body.code !== "string" || !(await verifyLinkCode(body.code, linkKeys()))) {
    return json({ error: { code: "invalid", message: "That link isn't valid." } }, 400);
  }
  const started = await startSignIn(request, { intent: { kind: body.intent, code: body.code }, screen: body.screen === "sign-up" ? "sign-up" : "sign-in" });
  if (!started) return json({ error: { code: "forbidden", message: "Accounts are off." } }, 404);
  const response = json({ url: started.url });
  setStateCookie(response.headers, started.sealed);
  return response;
}

/** Where the visitor lands after signing in: the finished intent's result, the return path, or Settings. */
async function landing(request: Request, userId: string, state: SignInState): Promise<URL> {
  const origin = appOrigin(request);
  if (state.intent) {
    const destination = await finishIntent(userId, state.intent);
    return new URL(destination, origin);
  }
  if (state.returnPath && state.returnPath !== DEFAULT_RETURN_PATH) return new URL(state.returnPath, origin);
  return new URL("/settings?account=signed-in#account", origin);
}

/**
 * GET /auth/callback: AuthKit sends the user back here with a code, which becomes the session cookie;
 * then the intent the visitor started with is completed (it was bound to this browser by the cookie).
 */
export async function authCallback(request: Request) {
  const config = accountConfig();
  const origin = appOrigin(request);
  const clear = (response: Response) => {
    setCookie(response.headers, STATE_COOKIE, "", { path: "/auth/callback", maxAge: 0 });
    return response;
  };
  // Anonymous: whether sign-in worked, under the day's hashed id, never who signed in.
  const record = (outcome: "ok" | "error", userId?: string) =>
    recordUsage({ name: "account.sign_in", outcome, country: requestCountry(request) }, requestIdentity(request, clientIp(request), userId));
  const done = (outcome: "error" | "busy") => {
    if (outcome === "error") record("error");
    return clear(redirect(new URL(`/settings?account=${outcome}#account`, origin)));
  };
  const password = statePassword();
  if ((!config && !devAuthEnabled()) || !password) return done("error");
  if ((await accountRateLimited(request)) !== null) return done("busy");

  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const expected = await unsealState(readCookie(request, STATE_COOKIE), password);
  if (!state || !expected || state !== expected.state) return done("error");

  const devUser = devUserId(params.get("dev_user"));
  if (devUser) {
    record("ok", devUser);
    const response = clear(redirect(await landing(request, devUser, expected)));
    setCookie(response.headers, DEV_USER_COOKIE, devUser.slice("user_dev_".length), { path: "/", sameSite: "lax", httpOnly: true, maxAge: 86_400 });
    setCookie(response.headers, SIGNED_IN_COOKIE, "1", { path: "/", sameSite: "lax", maxAge: 86_400 });
    return response;
  }
  const code = params.get("code");
  if (!config || !code) return done("error");
  let auth: Awaited<ReturnType<ReturnType<typeof workosClient>["userManagement"]["authenticateWithCode"]>>;
  try {
    auth = await workosClient(config).userManagement.authenticateWithCode({
      clientId: config.clientId,
      code,
      session: { sealSession: true, cookiePassword: config.cookiePassword },
    });
    if (!auth.sealedSession) throw new Error("WorkOS returned no sealed session.");
  } catch (error) {
    console.error("Sign-in could not be completed", error);
    return done("error");
  }
  record("ok", auth.user.id);
  return setSessionCookies(clear(redirect(await landing(request, auth.user.id, expected))), auth.sealedSession);
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

/**
 * DELETE /api/account: deletes the signed-in account (§14.4): its library and links, its plans (each
 * passes to its next member, or is deleted), its memberships, and the WorkOS user, which also ends
 * its AI assistants' access. Answers 202 once the account is marked; a step that fails is retried by
 * the account's alarm.
 */
export async function deleteAccount(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "Forbidden." }, 403);
  const devUser = devUserId(readCookie(request, DEV_USER_COOKIE));
  const config = accountConfig();
  if (!config && !devUser) return json({ error: "Accounts are off." }, 404);
  const retryAfter = await accountRateLimited(request);
  if (retryAfter !== null) return json({ error: "Too many requests." }, 429, { "Retry-After": String(retryAfter) });

  let userId = devUser;
  if (!userId) {
    const session = await readSession(readCookie(request, SESSION_COOKIE), config!);
    if (session.kind === "unavailable") return json({ error: "Your account can't be checked right now." }, 503);
    if (session.kind === "signed_out") return setSessionCookies(json({ error: "You're not signed in." }, 401), null);
    userId = session.userId;
  }
  const subject = userId;
  // Anonymous: whether the deletion went through, never whose account it was.
  const recordDeletion = (outcome: "ok" | "error") =>
    recordUsage({ name: "account.delete", outcome, country: requestCountry(request) }, requestIdentity(request, clientIp(request), subject));
  const env = platform().durable;
  try {
    if (env) {
      const result = await runAccountDeletion(env, userId);
      recordDeletion("ok");
      const response = setSessionCookies(json({ deleted: result === "done", pending: result === "pending" }, 202), null);
      if (devUser) setCookie(response.headers, DEV_USER_COOKIE, "", { path: "/", maxAge: 0 });
      return response;
    }
    // No Durable Objects here (tests, scripts): only the WorkOS user exists.
    await workosClient(config!).userManagement.deleteUser(userId);
  } catch (error) {
    console.error("Account could not be deleted", error);
    recordDeletion("error");
    return json({ error: "Your account couldn't be deleted. Try again." }, 502);
  }
  recordDeletion("ok");
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
 * GET /auth/dev-sign-in: development only (DEV_AUTH=1 in .dev.vars, and never in a production
 * build). Stands in for AuthKit so live hosting can be tried with two browsers locally.
 * - ?user=<name>&return=<path> signs this browser in as a local test user directly (?user= signs out);
 * - ?state=<state> (from a sign-in that started an intent) asks for a name, then returns through the
 *   callback, which completes the intent as it would after AuthKit.
 */
export async function devSignIn(request: Request) {
  if (!devAuthEnabled()) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (state !== null && !url.searchParams.has("user")) {
    const page = `<!doctype html><meta charset="utf-8"><title>Development sign-in</title>
<form method="get" action="/auth/callback"><input type="hidden" name="state" value="${state.replace(/[^A-Za-z0-9-]/g, "")}">
<label>Test user <input name="dev_user" pattern="[a-z0-9\\-]{1,32}" required autofocus></label> <button>Sign in</button></form>`;
    return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const name = url.searchParams.get("user") ?? "";
  const response = redirect(new URL(safeReturnPath(url.searchParams.get("return")), url.origin));
  const valid = devUserId(name) !== null;
  setCookie(response.headers, DEV_USER_COOKIE, valid ? name : "", { path: "/", sameSite: "lax", httpOnly: true, maxAge: valid ? 86_400 : 0 });
  setCookie(response.headers, SIGNED_IN_COOKIE, valid ? "1" : "", { path: "/", sameSite: "lax", maxAge: valid ? 86_400 : 0 });
  return response;
}
