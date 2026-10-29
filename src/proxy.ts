import { NextResponse, type NextRequest } from "next/server";
import { CLOUDFLARE_BEACON_HOST, CLOUDFLARE_INSIGHTS_HOST } from "@/app/lib/analytics/cloudflare";

export function buildContentSecurityPolicy(nonce: string, nodeEnv = process.env.NODE_ENV) {
  const developmentEval = nodeEnv === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    // strict-dynamic ignores the host allowlist. The beacon script carries this
    // request's nonce; the host remains for browsers that do not implement it.
    `script-src 'self' ${CLOUDFLARE_BEACON_HOST} 'nonce-${nonce}' 'strict-dynamic'${developmentEval}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://assets.tarkov.dev",
    `connect-src 'self' https://assets.tarkov.dev ${CLOUDFLARE_INSIGHTS_HOST}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Origin-Agent-Cluster", "?1");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), fullscreen=(self), clipboard-write=(self)"
  );
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = (forwardedHost || request.headers.get("host") || request.nextUrl.hostname)
    .split(":")[0]
    .toLowerCase();
  if (
    process.env.NODE_ENV === "production" &&
    (requestHost === "eft-toolset.com" || requestHost.endsWith(".eft-toolset.com"))
  ) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
