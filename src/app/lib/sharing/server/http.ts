import { crossIsolateLimit } from "@/app/lib/api/rate-limit";
import { readBodyWithLimit, RequestBodyBusyError, RequestBodyTooLargeError } from "@/app/lib/api/request-body";
import type { DurableBindings } from "@/app/lib/durable/access";
import type { Outcome } from "@/app/lib/durable/outcome";
import { DomainError } from "@/app/lib/durable/sql";
import { appOrigin } from "@/app/lib/account/server";
import { platform, type IpPool } from "@/app/lib/server/platform";
import type { ErrorCode } from "@/app/lib/sharing/types";

/** Shared pieces of the sharing routes (§10): JSON answers, error codes, body parsing, checks. */

const NO_STORE = { "Cache-Control": "no-store" };

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  gone: 410,
  conflict: 409,
  limit: 403,
  rate_limited: 429,
  invalid: 400,
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function errorResponse(code: ErrorCode, message: string, details?: Record<string, unknown>, headers: Record<string, string> = {}) {
  const retryAfter: Record<string, string> = typeof details?.retryAfterSeconds === "number" ? { "Retry-After": String(details.retryAfterSeconds) } : {};
  return json({ error: { code, message, ...(details ? { details } : {}) } }, STATUS[code], { ...retryAfter, ...headers });
}

/** Thrown inside a route to answer with an error; handled by `route`. */
export class RouteError extends Error {
  constructor(
    readonly response: Response,
    message = "Route answered early.",
    readonly code?: ErrorCode
  ) {
    super(message);
  }
}

export function fail(code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new RouteError(errorResponse(code, message, details), message, code);
}

export function unwrapOutcome<T>(result: Outcome<T>): T {
  if (result.ok) return result.value;
  return fail(result.error.code, result.error.message, result.error.details);
}

/** Runs a route body, turning refusals into error responses. Unknown errors are 500s with a log line. */
export async function route(work: () => Promise<Response>, headers: Record<string, string> = {}): Promise<Response> {
  let response: Response;
  try {
    response = await work();
  } catch (error) {
    if (error instanceof RouteError) response = error.response;
    else if (error instanceof DomainError) response = errorResponse(error.code, error.message, error.details);
    else {
      console.error("Sharing route failed", error);
      response = json({ error: { code: "internal", message: "Something went wrong. Try again." } }, 500);
    }
  }
  if (Object.keys(headers).length === 0 || response.status === 101) return response;
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}

/** The Durable Object bindings, or a 503 where there are none (tests without a platform, scripts). */
export function bindings(): DurableBindings {
  const durable = platform().durable;
  if (!durable) throw new RouteError(json({ error: { code: "unavailable", message: "Accounts aren't available here." } }, 503));
  return durable;
}

/**
 * Requests that change state must come from the site's own pages: Sec-Fetch-Site same-origin, or a
 * matching Origin where browsers don't send it (the account routes' rule).
 */
export function requireSameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site) {
    if (site !== "same-origin") fail("forbidden", "Requests must come from this site.");
    return;
  }
  const origin = request.headers.get("origin");
  if (origin === null || (origin !== new URL(request.url).origin && origin !== appOrigin(request))) fail("forbidden", "Requests must come from this site.");
}

/** WebSocket upgrades: the Origin must be this site, against cross-site WebSocket hijacking. */
export function requireSiteOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null || (origin !== new URL(request.url).origin && origin !== appOrigin(request))) fail("forbidden", "Connections must come from this site.");
}

export async function limitIp(request: Request, pool: IpPool) {
  const limited = await crossIsolateLimit(request, pool);
  if (limited) fail("rate_limited", "Too many requests. Try again shortly.", { retryAfterSeconds: limited.retryAfterSeconds });
}

export async function readJson<T = unknown>(request: Request, maxBytes = 1024 * 1024): Promise<T> {
  let text: string;
  try {
    text = await readBodyWithLimit(request, maxBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) fail("invalid", `The request is larger than ${Math.round(maxBytes / 1024)} KB.`);
    if (error instanceof RequestBodyBusyError) fail("rate_limited", "The service is busy. Try again shortly.", { retryAfterSeconds: 1 });
    fail("invalid", "The request body couldn't be read.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return fail("invalid", "The request body must be JSON.");
  }
}

/** Response headers for pages and answers that carry link codes or private content. */
export const NOINDEX = { "X-Robots-Tag": "noindex" };
