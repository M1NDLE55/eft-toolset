import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ItemGroupsLayout } from "@/app/item-groups/item-groups-layout";

export const Route = createFileRoute("/item-groups")({
  component: () => (
    <ItemGroupsLayout>
      <Outlet />
    </ItemGroupsLayout>
  ),
});
