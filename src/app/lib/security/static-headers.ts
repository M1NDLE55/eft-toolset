// Imported by vite.config.ts, so it uses relative imports with extensions only.
import { HSTS_VALUE, securityHeaders } from "./headers.ts";

/** The production hosts that get HSTS, as the Worker's HSTS_HOST_PATTERN matches them. */
const HSTS_HOSTS = ["https://eft-toolset.com", "https://www.eft-toolset.com"];

/**
 * The static assets' _headers file (Workers Static Assets): every file gets the headers the Worker
 * sets on pages, and on the production hosts HSTS; the service worker is never cached.
 */
export function staticAssetHeaders(nodeEnv = "production") {
  const security = securityHeaders(nodeEnv).map(({ key, value }) => `  ${key}: ${value}`);
  const lines = ["/*", ...security, ""];
  for (const host of HSTS_HOSTS) lines.push(`${host}/*`, `  Strict-Transport-Security: ${HSTS_VALUE}`, "");
  lines.push("/sw.js", "  Cache-Control: no-cache, no-store, must-revalidate", "");
  return lines.join("\n");
}
