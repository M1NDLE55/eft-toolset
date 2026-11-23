import { createServerFn } from "@tanstack/react-start";
import { getPriceHighlights } from "@/app/lib/api/tarkov-server";
import { readForRender } from "@/app/lib/api/server-render";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";

class PricesUnavailableError extends Error {
  constructor() {
    super("PVE prices are temporarily unavailable.");
    this.name = "PricesUnavailableError";
  }
}

/** PVE's price highlights. Fails the render rather than cache the page without its prices. */
export const fetchPvePriceHighlights = createServerFn({ method: "GET" }).handler(async () => {
  cacheAtEdge(EDGE_TTL.prices);
  const highlights = await readForRender("PVE prices page", () => getPriceHighlights("pve"));
  if (!highlights) throw new PricesUnavailableError();
  return highlights;
});
