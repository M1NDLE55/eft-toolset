import { createFileRoute } from "@tanstack/react-router";
import { CreditsPage, CREDITS_METADATA } from "@/app/credits/credits-page";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/credits")({
  staticData: { pageHead: true },
  head: () => pageHead({ page: CREDITS_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: CreditsPage,
});
