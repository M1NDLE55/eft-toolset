import { createServerFn } from "@tanstack/react-start";
import { getPriceHighlights } from "@/app/lib/api/tarkov-server";
import { requireForRender } from "@/app/lib/api/server-render";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";
import { requestGameMode } from "@/app/lib/server/request-mode";
import { loadItemPage } from "./detail/item-page.server";
import type { ItemHubData } from "./item-hub";

/** /item: the most valuable items per slot, overall and among keys. */
export const fetchItemHub = createServerFn({ method: "GET" }).handler(async (): Promise<ItemHubData> => {
  const gameMode = requestGameMode();
  cacheAtEdge(EDGE_TTL.prices);
  return { gameMode, highlights: await requireForRender("Item prices page", () => getPriceHighlights(gameMode)) };
});

/** /item/<slug or old name link>. */
export const fetchItemPage = createServerFn({ method: "GET" })
  .validator((input: { itemName: string }) => ({ itemName: String(input.itemName) }))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.builds);
    const page = await loadItemPage(requestGameMode(), data.itemName);
    // Built from stale copies: kept briefly, so a fresh render replaces it soon.
    if (page.stale) cacheAtEdge(EDGE_TTL.prices);
    return page;
  });
