import { createFileRoute } from "@tanstack/react-router";
import { ItemHub, itemHubMetadata } from "@/app/item/item-hub";
import { ITEM_LAYOUT_METADATA } from "@/app/item/item-layout";
import { fetchItemHub } from "@/app/item/item.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/item/")({
  loader: () => fetchItemHub(),
  staticData: { pageHead: true },
  head: () => pageHead({ own: ITEM_LAYOUT_METADATA, page: itemHubMetadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.prices),
  component: function ItemHubRoute() {
    return <ItemHub data={Route.useLoaderData()} />;
  },
});
