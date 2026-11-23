import { createServerFn } from "@tanstack/react-start";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";
import { requestGameMode } from "@/app/lib/server/request-mode";
import { loadQuestPage, loadQuestsHub } from "./quests.server";

export const fetchQuestsHub = createServerFn({ method: "GET" }).handler(async () => {
  cacheAtEdge(EDGE_TTL.daily);
  return loadQuestsHub(requestGameMode());
});

export const fetchQuestPage = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => ({ slug: String(input.slug) }))
  .handler(async ({ data }) => {
    cacheAtEdge(EDGE_TTL.daily);
    return loadQuestPage(requestGameMode(), data.slug);
  });
