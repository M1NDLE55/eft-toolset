import { createFileRoute } from "@tanstack/react-router";
import { CaliberPage } from "@/app/ammo/caliber-page";
import { fetchCaliberPage } from "@/app/ammo/ammo.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/ammo/$caliber")({
  loader: ({ params }) => fetchCaliberPage({ data: { caliber: params.caliber } }),
  staticData: { pageHead: true },
  head: ({ loaderData }) => pageHead({ page: loaderData?.metadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.prices),
  component: function CaliberRoute() {
    return <CaliberPage data={Route.useLoaderData()} />;
  },
});
