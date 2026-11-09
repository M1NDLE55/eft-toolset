import { RESOURCE_MAX_STALE_MS } from "./tarkov-server";

const SHARED_MAX_AGE_SECONDS = 300;
const MAX_STALE_WHILE_REVALIDATE_SECONDS = 86_400;

export function publicCacheControl(stale: boolean, dataAgeMs: number) {
  const remainingSeconds = Math.floor((RESOURCE_MAX_STALE_MS - dataAgeMs) / 1000);
  if (stale) return remainingSeconds > 30 ? "public, max-age=0, s-maxage=30" : "no-store";
  if (remainingSeconds <= SHARED_MAX_AGE_SECONDS) return "no-store";
  const swr = Math.min(MAX_STALE_WHILE_REVALIDATE_SECONDS, remainingSeconds - SHARED_MAX_AGE_SECONDS);
  return `public, max-age=60, s-maxage=${SHARED_MAX_AGE_SECONDS}, stale-while-revalidate=${swr}`;
}
