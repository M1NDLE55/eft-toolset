import { createFileRoute } from "@tanstack/react-router";
import { GunBuilderPage, GUN_BUILDER_PAGE_METADATA } from "@/app/gun-builder/gun-builder-page";
import { GUN_BUILDER_LAYOUT_METADATA } from "@/app/gun-builder/gun-builder-layout";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/gun-builder/")({
  staticData: { pageHead: true },
  head: () => pageHead({ own: GUN_BUILDER_LAYOUT_METADATA, page: GUN_BUILDER_PAGE_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: GunBuilderPage,
});
