import { base64url, fromBase64url } from "@/app/lib/sharing/ids";

/**
 * The sign-in state cookie (§15): `{ state, intent?, returnPath? }`, encrypted and authenticated
 * with AES-GCM under a key derived from WORKOS_COOKIE_PASSWORD, so the browser can neither read nor
 * change where it will be sent or what will be done for it. The intent is what the visitor clicked
 * before signing in ("Save a copy", "Join"); the callback completes it once, then clears the cookie.
 */
export type SignInIntent = { kind: "copy"; code: string } | { kind: "join"; code: string };

export interface SignInState {
  state: string;
  intent?: SignInIntent;
  returnPath?: string;
  /** Unix ms; the cookie's Max-Age also bounds it. */
  expiresAt: number;
}

const keys = new Map<string, Promise<CryptoKey>>();

function keyFor(password: string) {
  let key = keys.get(password);
  if (!key) {
    key = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(`eft-sign-in-state:${password}`))
      .then((digest) => crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]));
    keys.set(password, key);
  }
  return key;
}

export async function sealState(value: SignInState, password: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(password), new TextEncoder().encode(JSON.stringify(value))));
  const sealed = new Uint8Array(iv.length + ciphertext.length);
  sealed.set(iv);
  sealed.set(ciphertext, iv.length);
  return base64url(sealed);
}

/** The state, or null when the cookie is missing, altered, sealed with another key, or expired. */
export async function unsealState(sealed: string | undefined, password: string, now = Date.now()): Promise<SignInState | null> {
  if (!sealed || sealed.length > 4096) return null;
  const bytes = fromBase64url(sealed);
  if (!bytes || bytes.length < 13) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) as Uint8Array<ArrayBuffer> }, await keyFor(password), bytes.slice(12) as Uint8Array<ArrayBuffer>);
    const value = JSON.parse(new TextDecoder().decode(plain)) as SignInState;
    if (typeof value.state !== "string" || typeof value.expiresAt !== "number" || value.expiresAt < now) return null;
    return value;
  } catch {
    return null;
  }
}
