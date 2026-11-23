import type { GameMode } from "@/components/game-mode/mode";
import { publishPriceFeedFromUpstream, refreshSharedDataset, SHARED_RESOURCES } from "./tarkov-server";

const GAME_MODES: readonly GameMode[] = ["regular", "pve"];

/**
 * The cron (every minute; see wrangler.jsonc). It replaces the old site's ISR and CDN-cached feed:
 * - publishes each game mode's price feed to KV, revalidating tarkov.dev's items file with its
 *   ETag, so isolates read current prices without downloading that file;
 * - keeps the shared copies of the other datasets fresh in KV, asking tarkov.dev only when a copy
 *   is older than its freshness (30 minutes for maps and tasks, 2 hours for the rest).
 * Each step is independent: one failing leaves the others, and isolates fall back as before.
 */
export async function runScheduledRefresh(scheduledTime: number) {
  const outcomes: Record<string, string> = {};
  for (const gameMode of GAME_MODES) {
    try {
      outcomes[`${gameMode}/price-feed`] = await publishPriceFeedFromUpstream(gameMode);
    } catch (error) {
      outcomes[`${gameMode}/price-feed`] = `failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    for (const resource of SHARED_RESOURCES) {
      try {
        outcomes[`${gameMode}/${resource}`] = await refreshSharedDataset(gameMode, resource);
      } catch (error) {
        outcomes[`${gameMode}/${resource}`] = `failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }
  console.info(JSON.stringify({ event: "scheduled_refresh", scheduledTime: new Date(scheduledTime).toISOString(), outcomes }));
  return outcomes;
}
