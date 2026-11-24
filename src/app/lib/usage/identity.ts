import { platform } from "@/app/lib/server/platform";
import { memorySaltStorage, SaltStore, type SaltPeriod } from "./salt-store";

/**
 * The anonymous daily and weekly ids on each event, the way Plausible counts visitors: a keyed hash
 * (HMAC-SHA-256, cut to 64 bits) of who is asking, under a key that exists only for the current UTC
 * day or ISO week (salt-store.ts). The same person gets the same id all day, so the stats can count
 * unique visitors and how many actions each did; tomorrow they get an unrelated one, and once the
 * key is deleted nobody can work out whose id it was.
 *
 * Who is asking: the WorkOS user id when signed in (so one account counts once across the website
 * and every AI agent), otherwise the IP address and user agent. Those inputs exist only in this
 * function's memory; they are never written, logged or returned.
 */
export interface UsageIdentity {
  userId?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AnonymousIds {
  day: string;
  week: string;
  /** "1" signed in, "0" signed out, "" when the request couldn't be identified at all. */
  signedIn: "1" | "0" | "";
}

export const NO_IDS: AnonymousIds = { day: "", week: "", signedIn: "" };

/** Outside the Worker (tests, Node scripts) the keys live in this isolate's memory instead. */
let localStore = new SaltStore(memorySaltStorage());
const keyCache = new Map<SaltPeriod, Promise<{ key: CryptoKey; expiresAt: number }>>();

async function loadKey(kind: SaltPeriod, now: number) {
  const fetchSecret = platform().usageSecret;
  const { secret, expiresAt } = fetchSecret ? await fetchSecret(kind) : await localStore.secret(kind, now);
  const raw = new Uint8Array(secret.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));
  // Not extractable: once imported, the key can sign but can't be read back out of this isolate.
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { key, expiresAt };
}

async function periodKey(kind: SaltPeriod, now: number): Promise<CryptoKey> {
  const cached = keyCache.get(kind);
  if (cached) {
    const entry = await cached.catch(() => null);
    if (entry && now < entry.expiresAt) return entry.key;
  }
  const pending = loadKey(kind, now);
  keyCache.set(kind, pending);
  try {
    return (await pending).key;
  } catch (error) {
    keyCache.delete(kind);
    throw error;
  }
}

async function keyedHash(kind: SaltPeriod, subject: string, now: number) {
  const signature = await crypto.subtle.sign("HMAC", await periodKey(kind, now), new TextEncoder().encode(subject));
  return Array.from(new Uint8Array(signature, 0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function anonymousIds(identity: UsageIdentity | undefined, now = Date.now()): Promise<AnonymousIds> {
  const ip = identity?.ip && identity.ip !== "unknown" ? identity.ip : null;
  const subject = identity?.userId ? `user:${identity.userId}` : ip ? `visitor:${ip}\n${identity?.userAgent ?? ""}` : null;
  if (!subject) return NO_IDS;
  const [day, week] = await Promise.all([keyedHash("day", subject, now), keyedHash("week", subject, now)]);
  return { day, week, signedIn: identity?.userId ? "1" : "0" };
}

/** Forgets this isolate's cached keys and, outside the Worker, the keys themselves. For tests. */
export function resetUsageKeys(store?: SaltStore) {
  keyCache.clear();
  localStore = store ?? new SaltStore(memorySaltStorage());
}
