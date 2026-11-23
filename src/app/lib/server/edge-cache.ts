// Read by the Worker entry's page cache (page-cache.ts); set by routes and server functions.

/** A GET response carrying this header is kept at the edge for that many seconds. Never reaches clients. */
export const EDGE_TTL_HEADER = "X-EFT-Edge-TTL";

/**
 * How long each kind of page is kept before it renders again (served stale meanwhile), as the old
 * site's ISR `revalidate` values. See DATA_ARCHITECTURE.md ("Page caching").
 */
export const EDGE_TTL = {
  /** Prices are the content: item prices, PVE flea market, ammo, map keys. */
  prices: 300,
  /** Item pages (prices also refresh in the browser), best and Gunsmith builds. */
  builds: 21_600,
  /** Quests, the keys hub, raid-planner maps, the sitemap. */
  daily: 86_400,
  /** Pages whose HTML depends only on the code: kept until the next deployment, a year at most. */
  static: 31_536_000,
} as const;

export function edgeCacheHeaders(seconds: number): Record<string, string> {
  return { [EDGE_TTL_HEADER]: String(seconds) };
}
