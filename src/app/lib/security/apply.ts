import { HSTS_HOST_PATTERN, HSTS_VALUE, securityHeaders } from "./headers";

const HSTS_HOST = new RegExp(`^${HSTS_HOST_PATTERN}$`, "i");

/**
 * The headers every response gets, as the old next.config.ts set them: nosniff and the referrer
 * policy everywhere; on pages (not /api/), the security headers and, on the production domain, HSTS.
 * Headers a route set itself win.
 */
export function withSecurityHeaders(request: Request, response: Response): Response {
  const url = new URL(request.url);
  const headers = new Headers(response.headers);
  const add = (key: string, value: string) => {
    if (!headers.has(key)) headers.set(key, value);
  };
  add("X-Content-Type-Options", "nosniff");
  add("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!url.pathname.startsWith("/api/")) {
    for (const { key, value } of securityHeaders()) headers.set(key, value);
    if (HSTS_HOST.test(url.hostname)) headers.set("Strict-Transport-Security", HSTS_VALUE);
  }
  // Responses from the Cache API or a fetch have immutable headers; this builds a new response.
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers, webSocket: response.webSocket ?? undefined } as ResponseInit);
}
