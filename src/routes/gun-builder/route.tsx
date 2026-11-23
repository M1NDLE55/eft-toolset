import { createFileRoute, Outlet } from "@tanstack/react-router";
import { GunBuilderLayout } from "@/app/gun-builder/gun-builder-layout";

export const Route = createFileRoute("/gun-builder")({
  component: () => (
    <GunBuilderLayout>
      <Outlet />
    </GunBuilderLayout>
  ),
});
