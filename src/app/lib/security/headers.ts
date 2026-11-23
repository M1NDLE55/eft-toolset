// Imported by vite.config.ts (through static-headers.ts), so it uses relative imports only.
import { CLOUDFLARE_BEACON_HOST, CLOUDFLARE_INSIGHTS_HOST } from "../analytics/cloudflare.ts";

/**
 * One policy for every page, set by next.config.ts rather than per request. Content pages are
 * cached and served to everyone, so they can't carry a per-request nonce, and Next's inline RSC
 * scripts differ on every page, so they can't be hashed: inline scripts are allowed. Inline event
 * handlers stay blocked (script-src-attr), and scripts load only from this site and Cloudflare's
 * beacon host.
 */
export function buildContentSecurityPolicy(nodeEnv = process.env.NODE_ENV) {
  const developmentEval = nodeEnv === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline' ${CLOUDFLARE_BEACON_HOST}${developmentEval}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://assets.tarkov.dev https://static.wikia.nocookie.net",
    `connect-src 'self' https://assets.tarkov.dev ${CLOUDFLARE_INSIGHTS_HOST}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function securityHeaders(nodeEnv = process.env.NODE_ENV) {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(nodeEnv) },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "Origin-Agent-Cluster", value: "?1" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), fullscreen=(self), clipboard-write=(self)" },
  ];
}

/** HSTS only on the production domain, matched on the request's host. */
export const HSTS_HOST_PATTERN = "(?:.+\\.)?eft-toolset\\.com";
export const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";
