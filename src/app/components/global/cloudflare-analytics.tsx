import { cloudflareAnalyticsToken, cloudflareBeaconAttribute, CLOUDFLARE_BEACON_SRC } from "@/app/lib/analytics/cloudflare";

export function CloudflareAnalytics({ nonce }: { nonce?: string }) {
  const beacon = cloudflareBeaconAttribute(cloudflareAnalyticsToken());
  if (!beacon) return null;

  return (
    <script
      defer
      nonce={nonce}
      src={CLOUDFLARE_BEACON_SRC}
      data-cf-beacon={beacon}
    />
  );
}
