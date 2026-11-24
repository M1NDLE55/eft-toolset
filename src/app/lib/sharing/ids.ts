/**
 * Ids for account records: plans, builds and item groups. 128 random bits as base64url (22
 * characters). They reveal nothing (not how many exist) and grant nothing: every access checks
 * ownership, membership or a link. Browsers make them too, for records created offline.
 */
export const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function newRecordId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && RECORD_ID_PATTERN.test(value);
}

/** A random id for a mutation or op batch, unique enough to make replays idempotent. */
export function newOperationId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(12)));
}

export function isOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}
