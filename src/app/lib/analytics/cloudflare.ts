export const CLOUDFLARE_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";
export const CLOUDFLARE_BEACON_HOST = "https://static.cloudflareinsights.com";
export const CLOUDFLARE_INSIGHTS_HOST = "https://cloudflareinsights.com";

const TOKEN_ENV = "CLOUDFLARE_WEB_ANALYTICS_TOKEN";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;

export function cloudflareAnalyticsToken(env: NodeJS.ProcessEnv = process.env) {
  return env[TOKEN_ENV];
}

// The site token is public in the page, but it still has to stay inside the
// JSON attribute. Reject anything that is not the token shape Cloudflare issues.
export function cloudflareBeaconAttribute(token: string | undefined) {
  const trimmed = token?.trim() ?? "";
  if (!TOKEN_PATTERN.test(trimmed)) return null;
  return JSON.stringify({ token: trimmed, spa: true });
}
