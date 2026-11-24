import { base64url, fromBase64url } from "./ids";

/**
 * Link codes: a version character, then base64url(12 random bytes ‖ the first 3 bytes of
 * HMAC-SHA256(key[version], random)), 21 characters in all. The random part is the secret; the MAC
 * lets the Worker turn away forged and mistyped codes in memory, before any Durable Object call.
 * The version picks the key, so a new key can be added (and the old kept for checking) to rotate.
 */
export const LINK_CODE_LENGTH = 21;
const RANDOM_BYTES = 12;
const MAC_BYTES = 3;
const CODE_PATTERN = /^[1-9A-Za-z][A-Za-z0-9_-]{20}$/;

/** Version character → secret. The newest version (last key) signs new codes. */
export type LinkKeys = ReadonlyMap<string, string>;

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string) {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keyCache.set(secret, key);
  }
  return key;
}

async function mac(secret: string, random: Uint8Array) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), random as Uint8Array<ArrayBuffer>);
  return new Uint8Array(signature, 0, MAC_BYTES);
}

export async function createLinkCode(keys: LinkKeys): Promise<string> {
  const version = [...keys.keys()].at(-1);
  if (!version) throw new Error("No link key is configured.");
  const random = crypto.getRandomValues(new Uint8Array(RANDOM_BYTES));
  const body = new Uint8Array(RANDOM_BYTES + MAC_BYTES);
  body.set(random);
  body.set(await mac(keys.get(version)!, random), RANDOM_BYTES);
  return version + base64url(body);
}

/** Whether a code has the right shape and a MAC made with one of the keys. Constant-time compare. */
export async function verifyLinkCode(code: unknown, keys: LinkKeys): Promise<boolean> {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) return false;
  const secret = keys.get(code[0]);
  if (!secret) return false;
  const body = fromBase64url(code.slice(1));
  if (!body || body.length !== RANDOM_BYTES + MAC_BYTES) return false;
  const expected = await mac(secret, body.subarray(0, RANDOM_BYTES));
  let difference = 0;
  for (let index = 0; index < MAC_BYTES; index += 1) difference |= expected[index] ^ body[RANDOM_BYTES + index];
  return difference === 0;
}

/** How a code appears in logs: never the code itself. */
export async function logCode(code: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
  return Array.from(digest.subarray(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Parses LINK_KEYS ("1:secret,2:secret"), oldest first. Each secret must be at least 32 characters.
 * Outside production, a fixed development key is used when none is set.
 */
export function parseLinkKeys(setting: string | undefined, production: boolean): LinkKeys {
  const keys = new Map<string, string>();
  for (const part of (setting ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    const version = trimmed.slice(0, separator);
    const secret = trimmed.slice(separator + 1);
    if (separator !== 1 || !/^[1-9A-Za-z]$/.test(version) || secret.length < 32) {
      throw new Error("LINK_KEYS must be version:secret pairs with one-character versions and secrets of 32+ characters.");
    }
    keys.set(version, secret);
  }
  if (keys.size === 0 && !production) keys.set("1", "development-only-link-key-not-secret-0000");
  return keys;
}
