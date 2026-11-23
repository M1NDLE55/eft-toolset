import { createFileRoute, notFound } from "@tanstack/react-router";
import { GroupPage } from "@/app/item-groups/group-page";
import { ITEM_GROUPS_LAYOUT_METADATA } from "@/app/item-groups/item-groups-layout";
import { ItemGroupSkeleton, PRIVATE_PAGE_METADATA } from "@/app/components/global/page-frames";
import { customDecodeURI } from "@/app/lib/URIEncoding";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/item-groups/$group")({
  beforeLoad: ({ params }) => {
    if (!customDecodeURI(params.group)) throw notFound();
  },
  staticData: { pageHead: true },
  head: () => pageHead({ layouts: [ITEM_GROUPS_LAYOUT_METADATA], own: PRIVATE_PAGE_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  pendingComponent: ItemGroupSkeleton,
  component: GroupPage,
});
