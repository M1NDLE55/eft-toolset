import { createServerFn } from "@tanstack/react-start";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";
import { loadMapPage } from "./map/map-page.server";

export const fetchMapPage = createServerFn({ method: "GET" })
  .validator((input: { map: string }) => ({ map: String(input.map) }))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.daily);
    return loadMapPage(data.map);
  });
