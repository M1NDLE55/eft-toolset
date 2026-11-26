import { createServerFn } from "@tanstack/react-start";
import { getPriceHighlights } from "@/app/lib/api/tarkov-server";
import { readForRender, renderLivePrices } from "@/app/lib/api/server-render";
import { livePricesInput, type LivePricesInput } from "@/app/lib/prices/live-input";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";

class PricesUnavailableError extends Error {
  constructor() {
    super("PVE prices are temporarily unavailable.");
    this.name = "PricesUnavailableError";
  }
}

/** PVE's price highlights. Fails the render rather than cache the page without its prices. */
export const fetchPvePriceHighlights = createServerFn({ method: "GET" })
  .validator((input: LivePricesInput | undefined) => livePricesInput(input))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.prices);
    return renderLivePrices("pve", data, async () => {
      const highlights = await readForRender("PVE prices page", () => getPriceHighlights("pve"));
      if (!highlights) throw new PricesUnavailableError();
      return highlights;
    });
  });
