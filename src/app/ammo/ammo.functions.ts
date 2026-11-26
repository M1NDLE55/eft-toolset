import { createServerFn } from "@tanstack/react-start";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";
import { requestGameMode } from "@/app/lib/server/request-mode";
import { renderLivePrices } from "@/app/lib/api/server-render";
import { livePricesInput, type LivePricesInput } from "@/app/lib/prices/live-input";
import { loadAmmoHub, loadCaliberPage } from "./ammo.server";

export const fetchAmmoHub = createServerFn({ method: "GET" })
  .validator((input: LivePricesInput | undefined) => livePricesInput(input))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.prices);
    const gameMode = requestGameMode();
    return renderLivePrices(gameMode, data, () => loadAmmoHub(gameMode));
  });

export const fetchCaliberPage = createServerFn({ method: "GET" })
  .validator((input: { caliber: string } & LivePricesInput) => ({ caliber: String(input.caliber), ...livePricesInput(input) }))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.prices);
    const gameMode = requestGameMode();
    return renderLivePrices(gameMode, data, () => loadCaliberPage(gameMode, data.caliber));
  });
