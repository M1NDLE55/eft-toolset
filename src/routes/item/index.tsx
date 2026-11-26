import { createFileRoute } from "@tanstack/react-router";
import { ItemHub, itemHubMetadata } from "@/app/item/item-hub";
import { ITEM_LAYOUT_METADATA } from "@/app/item/item-layout";
import { fetchItemHub } from "@/app/item/item.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";
import { useLiveRoutePrices, wantedPricesVersion } from "@/app/lib/prices/live-prices";

export const Route = createFileRoute("/item/")({
  // `p`: the price version pushed to the page, once it has one (see live-prices.ts).
  loader: () => fetchItemHub({ data: { p: wantedPricesVersion() } }),
  staticData: { pageHead: true },
  head: () => pageHead({ own: ITEM_LAYOUT_METADATA, page: itemHubMetadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.prices),
  component: function ItemHubRoute() {
    const data = Route.useLoaderData();
    useLiveRoutePrices(Route.id, data.pricesVersion);
    return <ItemHub data={data} />;
  },
});
