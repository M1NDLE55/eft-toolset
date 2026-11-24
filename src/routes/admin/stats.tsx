import { createFileRoute } from "@tanstack/react-router";
import { ADMIN_STATS_METADATA, AdminStatsPage } from "@/app/admin/stats-page";
import { pageHead } from "@/app/lib/seo/metadata";

// The page holds no data: it fetches /api/admin/stats, which checks the admin's session.
export const Route = createFileRoute("/admin/stats")({
  staticData: { pageHead: true },
  head: () => pageHead({ own: ADMIN_STATS_METADATA }),
  component: AdminStatsPage,
});
