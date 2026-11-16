import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE } from "@/app/lib/account/cookies";
import { accountConfig, accountRateLimited, appOrigin, setSessionCookies, workosClient } from "@/app/lib/account/server";

export const dynamic = "force-dynamic";

/** AuthKit sends the user back here with a code, which becomes the session cookie. */
export async function GET(request: NextRequest) {
  const config = accountConfig();
  const origin = appOrigin(request);
  const done = (outcome: "signed-in" | "error" | "busy") => {
    const response = NextResponse.redirect(new URL(`/settings?account=${outcome}#account`, origin), 303);
    response.cookies.set(STATE_COOKIE, "", { path: "/auth/callback", maxAge: 0 });
    return response;
  };
  if (!config) return done("error");
  if (accountRateLimited(request) !== null) return done("busy");

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const expected = request.cookies.get(STATE_COOKIE)?.value;
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
