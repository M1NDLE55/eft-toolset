import { createFileRoute } from "@tanstack/react-router";
import { MapKeysPage } from "@/app/keys/map-keys-page";
import { fetchMapKeysPage } from "@/app/keys/keys.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/keys/$map")({
  loader: ({ params }) => fetchMapKeysPage({ data: { map: params.map } }),
  staticData: { pageHead: true },
  head: ({ loaderData }) => pageHead({ page: loaderData?.metadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.prices),
  component: function MapKeysRoute() {
    return <MapKeysPage data={Route.useLoaderData()} />;
  },
});
