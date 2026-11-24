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

/**
 * The beacon tracks client-side navigations (spa: true), so leaving it out of a page isn't enough
 * once it has loaded elsewhere. Routes whose paths carry link codes call this before they load:
 * a client-side navigation there becomes a full page load, which has no beacon.
 */
export function loadWithoutBeacon(href: string): Promise<void> | void {
  if (typeof document === "undefined") return;
  if (!document.querySelector(`script[src="${CLOUDFLARE_BEACON_SRC}"]`)) return;
  window.location.assign(href);
  return new Promise<void>(() => undefined);
}
