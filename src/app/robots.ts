import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/app/lib/site";

/** Search engines and AI search and answer bots, which send visitors. */
export const ALLOWED_BOTS = ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Claude-SearchBot"];

/** AI training crawlers (Google-Extended is a robots.txt token, not a crawler) and SEO tools, which crawl in bulk and send no one. */
export const BLOCKED_BOTS = ["GPTBot", "CCBot", "Bytespider", "ClaudeBot", "Google-Extended", "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: ALLOWED_BOTS, allow: "/" },
      { userAgent: BLOCKED_BOTS, disallow: "/" },
      { userAgent: "*", allow: "/" },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
