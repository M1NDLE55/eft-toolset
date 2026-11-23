import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ItemLayout } from "@/app/item/item-layout";

export const Route = createFileRoute("/item")({
  component: () => (
    <ItemLayout>
      <Outlet />
    </ItemLayout>
  ),
});
