import { createFileRoute } from "@tanstack/react-router";
import { QuestPage } from "@/app/quests/quest-page";
import { fetchQuestPage } from "@/app/quests/quests.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/quests/$slug")({
  loader: ({ params }) => fetchQuestPage({ data: { slug: params.slug } }),
  staticData: { pageHead: true },
  head: ({ loaderData }) => pageHead({ page: loaderData?.metadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.daily),
  component: function QuestRoute() {
    return <QuestPage data={Route.useLoaderData()} />;
  },
});
