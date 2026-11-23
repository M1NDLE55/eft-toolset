import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/app/settings/settings-page";
import { SETTINGS_METADATA } from "@/app/settings/settings-metadata";
import { pageHead } from "@/app/lib/seo/metadata";
import { EDGE_TTL, edgeCacheHeaders } from "@/app/lib/server/edge-cache";

export const Route = createFileRoute("/settings")({
  staticData: { pageHead: true },
  head: () => pageHead({ own: SETTINGS_METADATA }),
  headers: () => edgeCacheHeaders(EDGE_TTL.static),
  component: SettingsPage,
});
