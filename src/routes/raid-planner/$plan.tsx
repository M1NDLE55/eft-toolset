import { createFileRoute } from "@tanstack/react-router";
import { PlanPage } from "@/app/raid-planner/plan/plan-page";
import { RAID_PLANNER_LAYOUT_METADATA } from "@/app/raid-planner/raid-planner-layout";
import { MapLoading, PRIVATE_PAGE_METADATA } from "@/app/components/global/page-frames";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/raid-planner/$plan")({
  staticData: { pageHead: true },
  head: () => pageHead({ layouts: [RAID_PLANNER_LAYOUT_METADATA], own: PRIVATE_PAGE_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  pendingComponent: MapLoading,
  component: PlanPage,
});
