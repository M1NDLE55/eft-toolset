import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ReferenceFrame } from "@/app/components/global/page-frames";

export const Route = createFileRoute("/quests")({
  component: () => (
    <ReferenceFrame>
      <Outlet />
    </ReferenceFrame>
  ),
});
