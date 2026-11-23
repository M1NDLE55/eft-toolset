import { createFileRoute } from "@tanstack/react-router";
import { PveFleaMarketPage, PVE_FLEA_MARKET_METADATA } from "@/app/flea-market/pve-flea-market-page";
import { fetchPvePriceHighlights } from "@/app/flea-market/flea-market.functions";
import { FleaMarketFrame } from "@/app/components/global/page-frames";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/flea-market/pve")({
  loader: () => fetchPvePriceHighlights(),
  staticData: { pageHead: true },
  head: () => pageHead({ page: PVE_FLEA_MARKET_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.prices),
  component: function PveFleaMarketRoute() {
    return (
      <FleaMarketFrame>
        <PveFleaMarketPage highlights={Route.useLoaderData()} />
      </FleaMarketFrame>
    );
  },
});
