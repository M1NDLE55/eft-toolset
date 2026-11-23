import { createFileRoute } from "@tanstack/react-router";
import { GunsmithHub, GUNSMITH_HUB_METADATA } from "@/app/gun-builder/gunsmith/gunsmith-hub";
import { GUN_BUILDER_LAYOUT_METADATA } from "@/app/gun-builder/gun-builder-layout";
import { fetchGunsmithHub } from "@/app/gun-builder/builds.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/gun-builder/gunsmith/")({
  loader: () => fetchGunsmithHub(),
  staticData: { pageHead: true },
  head: () => pageHead({ layouts: [GUN_BUILDER_LAYOUT_METADATA], page: GUNSMITH_HUB_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.builds),
  component: function HubRoute() {
    return <GunsmithHub tasks={Route.useLoaderData()} />;
  },
});
