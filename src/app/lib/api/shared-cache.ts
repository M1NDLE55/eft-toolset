import { getCache } from "@vercel/functions";

/**
 * A small key-value cache shared by every server instance in a region: Vercel's Runtime Cache.
 * It is a best-effort optimisation, so a failure or a timeout reads as a miss and a failed
 * write is dropped. Off Vercel there is one process and nothing to share, so it is a no-op.
 *
 * Runtime Cache is billed per 8 KB read or written, and the Hobby plan includes 1M read units
 * and 200K write units a month across the whole team, so only small values that rarely change
 * belong here.
 */
export interface SharedCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

const runtimeCache: SharedCache = {
  async get(key) {
    try {
      return (await getCache({ namespace: "eft-toolset" }).get(key)) ?? null;
    } catch {
      return null;
    }
  },
  async set(key, value, ttlSeconds) {
    try {
      await getCache({ namespace: "eft-toolset" }).set(key, value, { ttl: ttlSeconds });
    } catch {
      // A dropped write only means another instance loads the value itself.
    }
  },
};

const noCache: SharedCache = {
  async get() {
    return null;
  },
  async set() {},
};

const defaultCache = process.env.VERCEL ? runtimeCache : noCache;
let current = defaultCache;

export function regionalCache(): SharedCache {
  return current;
}

/** Replaces the shared cache, or restores the default when called without one. For tests. */
export function setRegionalCacheForTests(cache?: SharedCache) {
  current = cache ?? defaultCache;
}
