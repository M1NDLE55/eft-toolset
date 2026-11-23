import { createFileRoute } from "@tanstack/react-router";
import { AmmoHub, ammoHubMetadata } from "@/app/ammo/ammo-hub";
import { fetchAmmoHub } from "@/app/ammo/ammo.functions";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/ammo/")({
  loader: () => fetchAmmoHub(),
  staticData: { pageHead: true },
  head: () => pageHead({ page: ammoHubMetadata }),
  headers: () => edgeCacheHeaders(EDGE_TTL.prices),
  component: function AmmoHubRoute() {
    return <AmmoHub data={Route.useLoaderData()} />;
  },
});
