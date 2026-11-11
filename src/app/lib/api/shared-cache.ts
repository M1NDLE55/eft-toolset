import { getCache } from "@vercel/functions";

// Best-effort regional cache (Vercel Runtime Cache, billed per 8 KB); disabled outside Vercel.
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

export function setRegionalCacheForTests(cache?: SharedCache) {
  current = cache ?? defaultCache;
}
