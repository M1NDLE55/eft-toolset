import { createServerFn } from "@tanstack/react-start";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";
import { requestGameMode } from "@/app/lib/server/request-mode";
import { loadKeyCounts, loadMapKeysPage } from "./keys.server";

export const fetchKeyCounts = createServerFn({ method: "GET" }).handler(async () => {
  cacheAtEdge(EDGE_TTL.daily);
  return loadKeyCounts();
});

export const fetchMapKeysPage = createServerFn({ method: "GET" })
  .validator((input: { map: string }) => ({ map: String(input.map) }))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.prices);
    return loadMapKeysPage(requestGameMode(), data.map);
  });
