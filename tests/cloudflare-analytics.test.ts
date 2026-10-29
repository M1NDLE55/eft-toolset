import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CloudflareAnalytics } from "@/app/components/global/cloudflare-analytics";
import { cloudflareBeaconAttribute } from "@/app/lib/analytics/cloudflare";

describe("Cloudflare Web Analytics beacon", () => {
  it("embeds the site token and enables SPA page views", () => {
    expect(cloudflareBeaconAttribute("0123456789abcdef0123")).toBe(
      '{"token":"0123456789abcdef0123","spa":true}'
    );
  });

  it("omits the beacon when the token is missing or not a site token", () => {
    expect(cloudflareBeaconAttribute(undefined)).toBeNull();
    expect(cloudflareBeaconAttribute("   ")).toBeNull();
    expect(cloudflareBeaconAttribute("short")).toBeNull();
    expect(cloudflareBeaconAttribute('token"injected')).toBeNull();
    expect(cloudflareBeaconAttribute("token<script>")).toBeNull();
  });

  it("renders the deferred beacon with the request nonce", () => {
    process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN = "0123456789abcdef0123";
    try {
      const html = renderToStaticMarkup(createElement(CloudflareAnalytics, { nonce: "abc" }));
      expect(html).toContain('src="https://static.cloudflareinsights.com/beacon.min.js"');
      expect(html).toContain('nonce="abc"');
      expect(html).toContain("defer");
      expect(html).toContain(
        'data-cf-beacon="{&quot;token&quot;:&quot;0123456789abcdef0123&quot;,&quot;spa&quot;:true}"'
      );
    } finally {
      delete process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN;
    }
  });

  it("renders no script unless the server token is configured", () => {
    const previous = process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN;
    delete process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN;
    try {
      expect(renderToStaticMarkup(createElement(CloudflareAnalytics, { nonce: "abc" }))).toBe("");
    } finally {
      if (previous === undefined) delete process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN;
      else process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN = previous;
    }
  });
});
