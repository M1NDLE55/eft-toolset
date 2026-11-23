import { createFileRoute } from "@tanstack/react-router";
import { DataPage } from "@/app/data/data-page";
import { DATA_METADATA } from "@/app/data/data-metadata";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/data")({
  staticData: { pageHead: true },
  head: () => pageHead({ own: DATA_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: DataPage,
});
