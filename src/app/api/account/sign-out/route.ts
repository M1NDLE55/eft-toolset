import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/app/lib/account/cookies";
import {
  accountConfig,
  accountRateLimited,
  appOrigin,
  isSameOriginRequest,
  readSession,
  setSessionCookies,
  workosClient,
} from "@/app/lib/account/server";

export const dynamic = "force-dynamic";

/**
 * Clears the session cookies and returns where to go next: AuthKit's logout URL, which ends
 * the WorkOS session too, or the settings page when there is no session to end. A POST
 * answered with JSON, because the site's form-action policy blocks a form that redirects
 * to another origin.
 */
export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403, headers });
  const settings = new URL("/settings#account", appOrigin(request)).href;
  const config = accountConfig();
  if (!config) return setSessionCookies(NextResponse.json({ url: settings }, { headers }), null);
  const retryAfter = accountRateLimited(request);
  if (retryAfter !== null) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } });
  }

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value, config);
  let url = settings;
  if (session.kind === "signed_in") {
    url = workosClient(config).userManagement.getLogoutUrl({ sessionId: session.sessionId, returnTo: settings });
  }
  return setSessionCookies(NextResponse.json({ url }, { headers }), null);
}
