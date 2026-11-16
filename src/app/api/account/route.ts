import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/app/lib/account/cookies";
import {
  accountConfig,
  accountRateLimited,
  accountUser,
  isSameOriginRequest,
  readSession,
  setSessionCookies,
  workosClient,
} from "@/app/lib/account/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** The signed-in user, or null. configured is false when accounts are off on this server. */
export async function GET(request: NextRequest) {
  const config = accountConfig();
  if (!config) return json({ configured: false, user: null });
  const retryAfter = accountRateLimited(request);
  if (retryAfter !== null) return json({ error: "Too many requests." }, 429, { "Retry-After": String(retryAfter) });

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value, config);
  if (session.kind === "unavailable") return json({ error: "Your account can't be checked right now." }, 503);
  if (session.kind === "signed_out") return setSessionCookies(json({ configured: true, user: null }), null);
  const response = json({ configured: true, user: accountUser(session.user) });
  return session.sealedSession ? setSessionCookies(response, session.sealedSession) : response;
}

/** Deletes the signed-in user from WorkOS, which also ends their AI assistants' access. */
export async function DELETE(request: NextRequest) {
  const config = accountConfig();
  if (!config) return json({ error: "Accounts are off." }, 404);
  if (!isSameOriginRequest(request)) return json({ error: "Forbidden." }, 403);
  const retryAfter = accountRateLimited(request);
  if (retryAfter !== null) return json({ error: "Too many requests." }, 429, { "Retry-After": String(retryAfter) });

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value, config);
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
