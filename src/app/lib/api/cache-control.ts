import { RESOURCE_MAX_STALE_MS } from "./tarkov-server";

const SHARED_MAX_AGE_SECONDS = 300;
const MAX_STALE_WHILE_REVALIDATE_SECONDS = 86_400;
// The price feed is read by our own instances for current prices, so the CDN keeps it a minute and
// serves it at most another minute while revalidating (see DATA_ARCHITECTURE.md, "Price feed").
const FEED_SHARED_MAX_AGE_SECONDS = 60;
const FEED_STALE_WHILE_REVALIDATE_SECONDS = 60;
const STALE_SHARED_MAX_AGE_SECONDS = 30;

export function publicCacheControl(stale: boolean, dataAgeMs: number) {
  const remainingSeconds = Math.floor((RESOURCE_MAX_STALE_MS - dataAgeMs) / 1000);
  if (stale) return staleCacheControl(remainingSeconds);
  if (remainingSeconds <= SHARED_MAX_AGE_SECONDS) return "no-store";
  const swr = Math.min(MAX_STALE_WHILE_REVALIDATE_SECONDS, remainingSeconds - SHARED_MAX_AGE_SECONDS);
  return `public, max-age=60, s-maxage=${SHARED_MAX_AGE_SECONDS}, stale-while-revalidate=${swr}`;
}

export function priceFeedCacheControl(stale: boolean, dataAgeMs: number) {
  const remainingSeconds = Math.floor((RESOURCE_MAX_STALE_MS - dataAgeMs) / 1000);
  if (stale) return staleCacheControl(remainingSeconds);
  if (remainingSeconds <= FEED_SHARED_MAX_AGE_SECONDS) return "no-store";
  const swr = Math.min(FEED_STALE_WHILE_REVALIDATE_SECONDS, remainingSeconds - FEED_SHARED_MAX_AGE_SECONDS);
  return `public, max-age=0, s-maxage=${FEED_SHARED_MAX_AGE_SECONDS}, stale-while-revalidate=${swr}`;
}

function staleCacheControl(remainingSeconds: number) {
  return remainingSeconds > STALE_SHARED_MAX_AGE_SECONDS
    ? `public, max-age=0, s-maxage=${STALE_SHARED_MAX_AGE_SECONDS}`
    : "no-store";
}
