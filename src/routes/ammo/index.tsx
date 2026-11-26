import { createFileRoute } from "@tanstack/react-router";
import { AmmoHub, ammoHubMetadata } from "@/app/ammo/ammo-hub";
import { fetchAmmoHub } from "@/app/ammo/ammo.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";
import { useLiveRoutePrices, wantedPricesVersion } from "@/app/lib/prices/live-prices";

export const Route = createFileRoute("/ammo/")({
  // `p`: the price version pushed to the page, once it has one (see live-prices.ts).
  loader: () => fetchAmmoHub({ data: { p: wantedPricesVersion() } }),
  staticData: { pageHead: true },
  head: () => pageHead({ page: ammoHubMetadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.prices),
  component: function AmmoHubRoute() {
    const data = Route.useLoaderData();
    useLiveRoutePrices(Route.id, data.pricesVersion);
    return <AmmoHub data={data} />;
  },
});
