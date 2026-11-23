import { createFileRoute } from "@tanstack/react-router";
import { BestBuildsPage } from "@/app/gun-builder/best/best-builds-page";
import { GUN_BUILDER_LAYOUT_METADATA } from "@/app/gun-builder/gun-builder-layout";
import { fetchBestBuildsPage } from "@/app/gun-builder/builds.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/gun-builder/best/$weapon")({
  loader: ({ params }) => fetchBestBuildsPage({ data: { weapon: params.weapon } }),
  staticData: { pageHead: true },
  head: ({ loaderData }) => pageHead({ layouts: [GUN_BUILDER_LAYOUT_METADATA], page: loaderData?.metadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.builds),
  component: function BuildRoute() {
    return <BestBuildsPage data={Route.useLoaderData()} />;
  },
});
