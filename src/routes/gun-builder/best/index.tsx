import { createFileRoute } from "@tanstack/react-router";
import { BestBuildsHub, BEST_BUILDS_HUB_METADATA } from "@/app/gun-builder/best/best-builds-hub";
import { GUN_BUILDER_LAYOUT_METADATA } from "@/app/gun-builder/gun-builder-layout";
import { fetchBestBuildsHub } from "@/app/gun-builder/builds.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/gun-builder/best/")({
  loader: () => fetchBestBuildsHub(),
  staticData: { pageHead: true },
  head: () => pageHead({ layouts: [GUN_BUILDER_LAYOUT_METADATA], page: BEST_BUILDS_HUB_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.builds),
  component: function HubRoute() {
    return <BestBuildsHub weapons={Route.useLoaderData()} />;
  },
});
