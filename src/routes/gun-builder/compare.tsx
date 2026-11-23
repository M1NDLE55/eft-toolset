import { createFileRoute } from "@tanstack/react-router";
import { ComparePage } from "@/app/gun-builder/compare/compare-page";
import { COMPARE_METADATA } from "@/app/gun-builder/compare/compare-metadata";
import { GUN_BUILDER_LAYOUT_METADATA } from "@/app/gun-builder/gun-builder-layout";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/gun-builder/compare")({
  staticData: { pageHead: true },
  head: () => pageHead({ layouts: [GUN_BUILDER_LAYOUT_METADATA], own: COMPARE_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: ComparePage,
});
