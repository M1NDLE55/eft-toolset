import { NextResponse } from "next/server";
import { STATE_COOKIE } from "@/app/lib/account/cookies";
import { accountConfig, accountRateLimited, appOrigin, callbackUrl, workosClient } from "@/app/lib/account/server";

export const dynamic = "force-dynamic";

const STATE_MAX_AGE_SECONDS = 10 * 60;

/** Starts AuthKit's hosted sign-in, or sign-up with ?screen=sign-up. */
export function GET(request: Request) {
  const config = accountConfig();
  const settings = new URL("/settings#account", appOrigin(request));
  if (!config) return NextResponse.redirect(settings, 303);
  if (accountRateLimited(request) !== null) return NextResponse.redirect(new URL("/settings?account=busy#account", settings), 303);

  const state = crypto.randomUUID();
  const screenHint = new URL(request.url).searchParams.get("screen") === "sign-up" ? "sign-up" : "sign-in";
  const url = workosClient(config).userManagement.getAuthorizationUrl({
    provider: "authkit",
    clientId: config.clientId,
    redirectUri: callbackUrl(request),
    state,
    screenHint,
  });
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(STATE_COOKIE, state, {
    path: "/auth/callback",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return response;
}
