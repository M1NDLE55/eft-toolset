import { createFileRoute } from "@tanstack/react-router";
import { DisclaimerPage, DISCLAIMER_METADATA } from "@/app/policies/disclaimer-page";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/policies/disclaimer-and-use-policy")({
  staticData: { pageHead: true },
  head: () => pageHead({ page: DISCLAIMER_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: DisclaimerPage,
});
