import { createServerFn } from "@tanstack/react-start";
import { getPriceHighlights } from "@/app/lib/api/tarkov-server";
import { renderLivePrices, requireForRender, type LivePricesData } from "@/app/lib/api/server-render";
import { livePricesInput, type LivePricesInput } from "@/app/lib/prices/live-input";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";
import { requestGameMode } from "@/app/lib/server/request-mode";
import { loadItemPage } from "./detail/item-page.server";
import type { ItemHubData } from "./item-hub";

/** /item: the most valuable items per slot, overall and among keys. */
export const fetchItemHub = createServerFn({ method: "GET" })
  .validator((input: LivePricesInput | undefined) => livePricesInput(input))
  .handler(async ({ data }): Promise<ItemHubData & LivePricesData> => {
    const gameMode = requestGameMode();
    cacheAtEdge(EDGE_TTL.prices);
    return renderLivePrices(gameMode, data, async () => ({
      gameMode,
      highlights: await requireForRender("Item prices page", () => getPriceHighlights(gameMode)),
    }));
  });

/** /item/<slug or old name link>. */
export const fetchItemPage = createServerFn({ method: "GET" })
  .validator((input: { itemName: string }) => ({ itemName: String(input.itemName) }))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.builds);
    const gameMode = requestGameMode();
    const page = await renderLivePrices(gameMode, {}, () => loadItemPage(gameMode, data.itemName));
    // Built from stale copies: kept briefly, so a fresh render replaces it soon.
    if (page.stale) cacheAtEdge(EDGE_TTL.prices);
    return page;
  });
