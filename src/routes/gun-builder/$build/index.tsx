import { createFileRoute } from "@tanstack/react-router";
import { BuildPage } from "@/app/gun-builder/build/build-page";
import { GUN_BUILDER_LAYOUT_METADATA } from "@/app/gun-builder/gun-builder-layout";
import { PRIVATE_PAGE_METADATA } from "@/app/components/global/page-frames";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/gun-builder/$build/")({
  staticData: { pageHead: true },
  head: () => pageHead({ layouts: [GUN_BUILDER_LAYOUT_METADATA], own: PRIVATE_PAGE_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: BuildPage,
});
