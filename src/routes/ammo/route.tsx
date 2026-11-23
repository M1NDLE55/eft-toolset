import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ReferenceFrame } from "@/app/components/global/page-frames";

export const Route = createFileRoute("/ammo")({
  component: () => (
    <ReferenceFrame>
      <Outlet />
    </ReferenceFrame>
  ),
});
