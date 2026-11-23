import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RaidPlannerLayout } from "@/app/raid-planner/raid-planner-layout";

export const Route = createFileRoute("/raid-planner")({
  component: () => (
    <RaidPlannerLayout>
      <Outlet />
    </RaidPlannerLayout>
  ),
});
