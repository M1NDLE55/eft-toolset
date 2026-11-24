import { SESSION_COOKIE } from "@/app/lib/account/cookies";
import { accountConfig, readSession, setSessionCookies } from "@/app/lib/account/server";
import { readCookie } from "@/app/lib/server/cookies";
import { fail } from "./http";

/**
 * Who is calling a sharing route: the WorkOS user behind the sealed session cookie. A refreshed
 * session's new cookie is written onto the response by `withSession`.
 *
 * Development only: with DEV_AUTH=1 in .dev.vars, `/auth/dev-sign-in?user=<name>` sets a plain
 * cookie naming a test user, so two browsers (and an MCP client, with `Bearer dev:<name>`) can be
 * different users locally without WorkOS. `import.meta.env.DEV` is false in production builds, so
 * the bundler drops this path from the deployed Worker entirely, unless the bundle was built with
 * EFT_LOCAL_E2E=1 for a local `wrangler dev` run.
 */
export const DEV_USER_COOKIE = "eft_dev_user";
const DEV_USER_PATTERN = /^[a-z0-9-]{1,32}$/;

export function devAuthEnabled() {
  return (import.meta.env.DEV || import.meta.env.EFT_LOCAL_E2E === true) && process.env.DEV_AUTH === "1";
}

export function devUserId(name: string | undefined | null): string | null {
  if (!devAuthEnabled() || !name || !DEV_USER_PATTERN.test(name)) return null;
  return `user_dev_${name}`;
}

export type CallerSession =
  | { kind: "user"; userId: string; sealedSession?: string }
  | { kind: "signed_out" }
  | { kind: "unavailable" };

export async function callerSession(request: Request): Promise<CallerSession> {
  const dev = devUserId(readCookie(request, DEV_USER_COOKIE));
  if (dev) return { kind: "user", userId: dev };
  const config = accountConfig();
  if (!config) return { kind: "signed_out" };
  const session = await readSession(readCookie(request, SESSION_COOKIE), config);
  if (session.kind === "signed_in") return { kind: "user", userId: session.userId, sealedSession: session.sealedSession };
  return session;
}

/** The signed-in user's id, or the route answers 401 (or 503 when WorkOS can't be reached). */
export async function requireUser(request: Request): Promise<{ userId: string; sealedSession?: string }> {
  const session = await callerSession(request);
  if (session.kind === "unavailable") fail("unauthenticated", "Your sign-in can't be checked right now. Try again shortly.", { retryable: true });
  if (session.kind === "signed_out") fail("unauthenticated", "Sign in to do that.");
  return session;
}

/** Writes a refreshed session cookie onto the response. */
export function withSession(response: Response, session: { sealedSession?: string } | null) {
  if (!session?.sealedSession) return response;
  const headers = new Headers(response.headers);
  const copy = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  return setSessionCookies(copy, session.sealedSession);
}
