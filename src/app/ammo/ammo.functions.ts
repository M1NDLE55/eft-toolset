import { createServerFn } from "@tanstack/react-start";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";
import { requestGameMode } from "@/app/lib/server/request-mode";
import { loadAmmoHub, loadCaliberPage } from "./ammo.server";

export const fetchAmmoHub = createServerFn({ method: "GET" }).handler(async () => {
  cacheAtEdge(EDGE_TTL.prices);
  return loadAmmoHub(requestGameMode());
});

export const fetchCaliberPage = createServerFn({ method: "GET" })
  .validator((input: { caliber: string }) => ({ caliber: String(input.caliber) }))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.prices);
    return loadCaliberPage(requestGameMode(), data.caliber);
  });
