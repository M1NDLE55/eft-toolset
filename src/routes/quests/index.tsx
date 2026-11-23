import { createFileRoute } from "@tanstack/react-router";
import { QuestsHub, questsHubMetadata } from "@/app/quests/quests-hub";
import { fetchQuestsHub } from "@/app/quests/quests.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/quests/")({
  loader: () => fetchQuestsHub(),
  staticData: { pageHead: true },
  head: () => pageHead({ page: questsHubMetadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.daily),
  component: function QuestsHubRoute() {
    return <QuestsHub loaded={Route.useLoaderData()} />;
  },
});
