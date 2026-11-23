import { createFileRoute } from "@tanstack/react-router";
import { HomePage, HOME_METADATA } from "@/app/home/home-page";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/")({
  staticData: { pageHead: true },
  head: () => pageHead({ page: HOME_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: HomePage,
});
