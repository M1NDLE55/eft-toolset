import { createFileRoute } from "@tanstack/react-router";
import { AccountPlanPage } from "@/app/raid-planner/plan/account-plan-page";
import { RAID_PLANNER_LAYOUT_METADATA } from "@/app/raid-planner/raid-planner-layout";
import { MapLoading, PRIVATE_PAGE_METADATA } from "@/app/components/global/page-frames";
import { pageHead } from "@/app/lib/seo/metadata";

export const Route = createFileRoute("/raid-planner/p/$planId")({
  staticData: { pageHead: true },
  head: () => pageHead({ layouts: [RAID_PLANNER_LAYOUT_METADATA], own: PRIVATE_PAGE_METADATA }),
  // A member's plan: the page is the same for everyone and loads the plan in the browser, but it is never indexed.
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }),
  pendingComponent: MapLoading,
  component: AccountPlanPage,
});
