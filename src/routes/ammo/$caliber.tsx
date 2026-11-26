import { createFileRoute } from "@tanstack/react-router";
import { CaliberPage } from "@/app/ammo/caliber-page";
import { fetchCaliberPage } from "@/app/ammo/ammo.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";
import { useLiveRoutePrices, wantedPricesVersion } from "@/app/lib/prices/live-prices";

export const Route = createFileRoute("/ammo/$caliber")({
  // `p`: the price version pushed to the page, once it has one (see live-prices.ts).
  loader: ({ params }) => fetchCaliberPage({ data: { caliber: params.caliber, p: wantedPricesVersion() } }),
  staticData: { pageHead: true },
  head: ({ loaderData }) => pageHead({ page: loaderData?.metadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.prices),
  component: function CaliberRoute() {
    const data = Route.useLoaderData();
    useLiveRoutePrices(Route.id, data.pricesVersion);
    return <CaliberPage data={data} />;
  },
});
