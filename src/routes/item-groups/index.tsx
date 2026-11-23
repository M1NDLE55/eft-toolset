import { createFileRoute } from "@tanstack/react-router";
import { ItemGroupsPage } from "@/app/item-groups/item-groups-page";
import { ITEM_GROUPS_LAYOUT_METADATA } from "@/app/item-groups/item-groups-layout";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/item-groups/")({
  staticData: { pageHead: true },
  head: () => pageHead({ own: ITEM_GROUPS_LAYOUT_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: ItemGroupsPage,
});
