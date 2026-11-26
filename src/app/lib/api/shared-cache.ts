import { platform } from "@/app/lib/server/platform";

/**
 * Data shared by every isolate, as instances read it: Workers KV in production (see src/server.ts),
 * nothing elsewhere. Only the refresher (data-refresh-do.ts) writes it. Best effort: failures and
 * timeouts read as misses, because the resource cache can always ask tarkov.dev or fall back to its
 * own copy.
 */
export interface SharedCache {
  get(key: string): Promise<unknown>;
}

const READ_TIMEOUT_MS = 2_000;

function storeCache(): SharedCache | null {
  const store = platform().sharedStore;
  if (!store) return null;
  return {
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
  };
}

const noCache: SharedCache = {
  async get() {
    return null;
  },
};

let override: SharedCache | undefined;

export function regionalCache(): SharedCache {
  return override ?? storeCache() ?? noCache;
}

export function setRegionalCacheForTests(cache?: SharedCache) {
  override = cache;
}
