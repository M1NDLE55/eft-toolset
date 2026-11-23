import { createFileRoute } from "@tanstack/react-router";
import { RaidPlannerPage, RAID_PLANNER_PAGE_METADATA } from "@/app/raid-planner/raid-planner-page";
import { RAID_PLANNER_LAYOUT_METADATA } from "@/app/raid-planner/raid-planner-layout";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/raid-planner/")({
  staticData: { pageHead: true },
  head: () => pageHead({ own: RAID_PLANNER_LAYOUT_METADATA, page: RAID_PLANNER_PAGE_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: RaidPlannerPage,
});
