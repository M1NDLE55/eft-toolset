import { base64url } from "@/app/lib/sharing/ids";
import { parseLinkKeys, type LinkKeys } from "@/app/lib/sharing/link-code";

/**
 * Server-side keys for sharing. LINK_KEYS signs link codes (a Wrangler secret, "1:<32+ chars>";
 * add "2:<secret>" to rotate). Outside production a fixed development key stands in, so local runs
 * need no setup. The account cache key is derived from the session cookie password.
 */
const production = () => process.env.NODE_ENV === "production" && !import.meta.env.DEV;

let cached: { setting: string | undefined; keys: LinkKeys } | undefined;

export function linkKeys(): LinkKeys {
  const setting = process.env.LINK_KEYS;
  if (!cached || cached.setting !== setting) cached = { setting, keys: parseLinkKeys(setting, production()) };
  return cached.keys;
}

/** Whether link codes can be made here; false in production until LINK_KEYS is set. */
export function sharingConfigured() {
  try {
    return linkKeys().size > 0;
  } catch (error) {
    console.error("Sharing is off:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

function serverSecret() {
  return process.env.WORKOS_COOKIE_PASSWORD?.trim() || "development-only-cache-key-not-secret-000";
}

/**
 * The browser names its account cache with this (§12.1), so the IndexedDB database name never
 * shows the WorkOS user id. Stable per user.
 */
export async function accountCacheKey(userId: string) {
  return base64url((await hmac(serverSecret(), `account-cache:${userId}`)).subarray(0, 12));
}

/** An anonymous reporter's identity: an HMAC of their IP, never the IP itself. */
export async function hashedIp(ip: string) {
  return base64url((await hmac(serverSecret(), `reporter-ip:${ip}`)).subarray(0, 12));
}
