import { createFileRoute } from "@tanstack/react-router";
import { MapKeysPage } from "@/app/keys/map-keys-page";
import { fetchMapKeysPage } from "@/app/keys/keys.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";
import { useLiveRoutePrices, wantedPricesVersion } from "@/app/lib/prices/live-prices";

export const Route = createFileRoute("/keys/$map")({
  // `p`: the price version pushed to the page, once it has one (see live-prices.ts).
  loader: ({ params }) => fetchMapKeysPage({ data: { map: params.map, p: wantedPricesVersion() } }),
  staticData: { pageHead: true },
  head: ({ loaderData }) => pageHead({ page: loaderData?.metadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.prices),
  component: function MapKeysRoute() {
    const data = Route.useLoaderData();
    useLiveRoutePrices(Route.id, data.pricesVersion);
    return <MapKeysPage data={data} />;
  },
});
