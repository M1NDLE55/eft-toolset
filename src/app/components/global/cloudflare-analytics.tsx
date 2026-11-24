import { useRouterState } from "@tanstack/react-router";
import { cloudflareAnalyticsToken, cloudflareBeaconAttribute, CLOUDFLARE_BEACON_SRC } from "@/app/lib/analytics/cloudflare";

/** Pages whose paths carry link codes, or that need no analytics: no beacon (§16.4). */
const NO_ANALYTICS = [/^\/s\//, /^\/join(?:\/|$)/, /^\/raid-planner\/p\//];

export function CloudflareAnalytics() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return <CloudflareBeacon pathname={pathname} />;
}

export function CloudflareBeacon({ pathname = "/" }: { pathname?: string }) {
  const beacon = cloudflareBeaconAttribute(cloudflareAnalyticsToken());
  if (!beacon || NO_ANALYTICS.some((pattern) => pattern.test(pathname))) return null;

  return (
    <script
      defer
      src={CLOUDFLARE_BEACON_SRC}
      data-cf-beacon={beacon}
    />
  );
}
