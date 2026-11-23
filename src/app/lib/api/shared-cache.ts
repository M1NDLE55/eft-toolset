import { platform } from "@/app/lib/server/platform";

/**
 * Data shared by every isolate: Workers KV in production (see src/server.ts), nothing elsewhere.
 * Best effort: failures and timeouts read as misses, and writes that fail are dropped, because the
 * resource cache can always ask tarkov.dev or fall back to its own copy.
 */
export interface SharedCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** The largest value, as JSON characters, this cache takes. */
  readonly maxChars: number;
}

/** KV's minimum expiration. */
const MIN_TTL_SECONDS = 60;
/** KV takes values up to 25 MiB; leave room for multi-byte characters. */
const KV_MAX_CHARS = 12_000_000;
const READ_TIMEOUT_MS = 2_000;

function storeCache(): SharedCache | null {
  const store = platform().sharedStore;
  if (!store) return null;
  return {
    maxChars: KV_MAX_CHARS,
    async get(key) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const text = await Promise.race([
          store.get(key),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS);
          }),
        ]);
        return text === null ? null : (JSON.parse(text) as unknown);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        await store.put(key, JSON.stringify(value), { expirationTtl: Math.max(MIN_TTL_SECONDS, Math.ceil(ttlSeconds)) });
      } catch {
        // Another isolate may be writing the same key (KV takes one write per key per second).
      }
    },
  };
}

const noCache: SharedCache = {
  maxChars: 0,
  async get() {
    return null;
  },
  async set() {},
};

let override: SharedCache | undefined;

export function regionalCache(): SharedCache {
  return override ?? storeCache() ?? noCache;
}

export function setRegionalCacheForTests(cache?: Omit<SharedCache, "maxChars"> & { maxChars?: number }) {
  override = cache ? { maxChars: 1_000_000, ...cache } : undefined;
}
