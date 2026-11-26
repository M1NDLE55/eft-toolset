import { createFileRoute } from "@tanstack/react-router";
import { PveFleaMarketPage, PVE_FLEA_MARKET_METADATA } from "@/app/flea-market/pve-flea-market-page";
import { fetchPvePriceHighlights } from "@/app/flea-market/flea-market.functions";
import { FleaMarketFrame } from "@/app/components/global/page-frames";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";
import { useLiveRoutePrices, wantedPricesVersion } from "@/app/lib/prices/live-prices";

export const Route = createFileRoute("/flea-market/pve")({
  // `p`: the PVE price version pushed to the page, once it has one (see live-prices.ts).
  loader: () => fetchPvePriceHighlights({ data: { p: wantedPricesVersion("pve") } }),
  staticData: { pageHead: true },
  head: () => pageHead({ page: PVE_FLEA_MARKET_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.prices),
  component: function PveFleaMarketRoute() {
    const highlights = Route.useLoaderData();
    useLiveRoutePrices(Route.id, highlights.pricesVersion, "pve");
    return (
      <FleaMarketFrame>
        <PveFleaMarketPage highlights={highlights} />
      </FleaMarketFrame>
    );
  },
});
