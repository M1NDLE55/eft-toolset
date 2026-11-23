import { createFileRoute } from "@tanstack/react-router";
import { GunsmithPage } from "@/app/gun-builder/gunsmith/gunsmith-page";
import { GUN_BUILDER_LAYOUT_METADATA } from "@/app/gun-builder/gun-builder-layout";
import { fetchGunsmithPage } from "@/app/gun-builder/builds.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/gun-builder/gunsmith/$task")({
  loader: ({ params }) => fetchGunsmithPage({ data: { task: params.task } }),
  staticData: { pageHead: true },
  head: ({ loaderData }) => pageHead({ layouts: [GUN_BUILDER_LAYOUT_METADATA], page: loaderData?.metadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.builds),
  component: function BuildRoute() {
    return <GunsmithPage data={Route.useLoaderData()} />;
  },
});
