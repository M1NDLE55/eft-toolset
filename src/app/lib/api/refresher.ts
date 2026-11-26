import type { GameMode } from "@/components/game-mode/mode";
import { platform } from "@/app/lib/server/platform";

// What instances ask the refresher (DataRefreshDO, one per game mode) and what it answers. The
// refresher is the only caller of tarkov.dev for prices and the shared datasets: it checks only when
// a check is due and shares one check among every instance asking. See DATA_ARCHITECTURE.md
// ("Refresher").

export interface PricesAnswer {
  /** The feed's version: rises each time tarkov.dev publishes new prices. Null until the first check. */
  version: number | null;
  /** When the refresher last confirmed the prices with tarkov.dev. */
  confirmedAt: number;
  /** Before this, tarkov.dev isn't expected to have newer prices: instances don't ask again. */
  nextCheckAt: number;
  /** The last check failed, so the prices may be older than they should be. */
  stale: boolean;
  /** The feed itself (the `price.feed` body), when the caller's version isn't the current one. */
  body?: string;
}

export interface DatasetAnswer {
  /** The shared copy's version (its ETag, or Last-Modified), whose body is in the shared store. Null while there is none. */
  version: string | null;
  etag: string | null;
  lastModified: string | null;
  /** When the refresher last confirmed it with tarkov.dev. */
  checkedAt: number;
  /** The last check failed. */
  stale: boolean;
}

/** The refresher's methods, as the Worker reaches them over RPC. */
export interface DataRefresher {
  /** The current prices, after a check if one is due (shared with any check in flight). */
  prices(gameMode: GameMode, have: number | null): Promise<PricesAnswer>;
  /**
   * A shared dataset's current version, after a check if its copy is over an hour old. `missing`:
   * the caller found no body for the version it was given, so the refresher writes it again.
   */
  dataset(gameMode: GameMode, resource: string, have: string | null, missing?: boolean): Promise<DatasetAnswer>;
}

/** The refresher for a game mode, in the Worker; null elsewhere (tests, scripts), where instances ask tarkov.dev themselves. */
export function refresher(gameMode: GameMode): DataRefresher | null {
  return platform().refresher?.(gameMode) ?? null;
}

/**
 * Local simulations only: with a stand-in tarkov.dev (TARKOV_UPSTREAM_URL), REFRESH_TIME_SCALE=<n>
 * runs the refresher's clocks n times faster (a 10-minute cycle in 10/n minutes, the hourly datasets
 * in 60/n), so hours of schedules can be watched in minutes. Always 1 in production, which never sets
 * TARKOV_UPSTREAM_URL.
 */
export function devTimeScale(): number {
  if (typeof process === "undefined" || !process.env.TARKOV_UPSTREAM_URL) return 1;
  const scale = Number(process.env.REFRESH_TIME_SCALE);
  return Number.isFinite(scale) && scale >= 1 && scale <= 600 ? scale : 1;
}

/** The shared store's key for a mode's current price feed, written by the refresher when the prices change. */
export function priceFeedStoreKey(gameMode: GameMode, format: number) {
  return `price-feed:${format}:${gameMode}`;
}
