import { createFileRoute } from "@tanstack/react-router";
import { KeysHub, KEYS_HUB_METADATA } from "@/app/keys/keys-hub";
import { fetchKeyCounts } from "@/app/keys/keys.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/keys/")({
  loader: () => fetchKeyCounts(),
  staticData: { pageHead: true },
  head: () => pageHead({ page: KEYS_HUB_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.daily),
  component: function KeysHubRoute() {
    return <KeysHub counts={Route.useLoaderData()} />;
  },
});
