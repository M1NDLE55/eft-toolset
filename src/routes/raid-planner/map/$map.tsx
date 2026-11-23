import { createFileRoute } from "@tanstack/react-router";
import { MapPage } from "@/app/raid-planner/map/map-page";
import { fetchMapPage } from "@/app/raid-planner/raid-planner.functions";
import { RAID_PLANNER_LAYOUT_METADATA } from "@/app/raid-planner/raid-planner-layout";
import { MapLoading } from "@/app/components/global/page-frames";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/raid-planner/map/$map")({
  loader: ({ params }) => fetchMapPage({ data: { map: params.map } }),
  staticData: { pageHead: true },
  head: ({ loaderData }) => pageHead({ layouts: [RAID_PLANNER_LAYOUT_METADATA], page: loaderData?.metadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.daily),
  pendingComponent: MapLoading,
  component: function MapRoute() {
    return <MapPage data={Route.useLoaderData()} />;
  },
});
