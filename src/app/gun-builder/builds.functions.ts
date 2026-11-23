import { createServerFn } from "@tanstack/react-start";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";
import { requestGameMode } from "@/app/lib/server/request-mode";
import { loadBestBuildsHub, loadBestBuildsPage, loadGunsmithHub, loadGunsmithPage } from "./builds.server";

export const fetchBestBuildsHub = createServerFn({ method: "GET" }).handler(async () => {
  cacheAtEdge(EDGE_TTL.builds);
  return loadBestBuildsHub();
});

export const fetchBestBuildsPage = createServerFn({ method: "GET" })
  .validator((input: { weapon: string }) => ({ weapon: String(input.weapon) }))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.builds);
    return loadBestBuildsPage(requestGameMode(), data.weapon);
  });

export const fetchGunsmithHub = createServerFn({ method: "GET" }).handler(async () => {
  cacheAtEdge(EDGE_TTL.builds);
  return loadGunsmithHub();
});

export const fetchGunsmithPage = createServerFn({ method: "GET" })
  .validator((input: { task: string }) => ({ task: String(input.task) }))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.builds);
    return loadGunsmithPage(requestGameMode(), data.task);
  });
