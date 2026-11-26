import { createServerFn } from "@tanstack/react-start";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";
import { requestGameMode } from "@/app/lib/server/request-mode";
import { renderLivePrices } from "@/app/lib/api/server-render";
import { livePricesInput, type LivePricesInput } from "@/app/lib/prices/live-input";
import { loadKeyCounts, loadMapKeysPage } from "./keys.server";

export const fetchKeyCounts = createServerFn({ method: "GET" }).handler(async () => {
  cacheAtEdge(EDGE_TTL.daily);
  return loadKeyCounts();
});

export const fetchMapKeysPage = createServerFn({ method: "GET" })
  .validator((input: { map: string } & LivePricesInput) => ({ map: String(input.map), ...livePricesInput(input) }))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.prices);
    const gameMode = requestGameMode();
    return renderLivePrices(gameMode, data, () => loadMapKeysPage(gameMode, data.map));
  });
