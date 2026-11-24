import { SITE_ORIGIN } from "@/app/lib/site";

/** Search engines and AI search and answer bots, which send visitors. */
export const ALLOWED_BOTS = ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Claude-SearchBot"];

/** AI training crawlers (Google-Extended is a robots.txt token, not a crawler) and SEO tools, which crawl in bulk and send no one. */
export const BLOCKED_BOTS = ["GPTBot", "CCBot", "Bytespider", "ClaudeBot", "Google-Extended", "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot"];

export interface RobotsRules {
  rules: { userAgent: string | string[]; allow?: string; disallow?: string | string[] }[];
  sitemap: string;
}

/** Shared links, invites and members' plan pages: unlisted, never indexed (§16.1). */
export const PRIVATE_PATHS = ["/s/", "/join", "/raid-planner/p/"];

export default function robots(): RobotsRules {
  return {
    rules: [
      { userAgent: ALLOWED_BOTS, allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: BLOCKED_BOTS, disallow: "/" },
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}

/** robots.txt as the site has always served it. */
export function robotsTxt(rules: RobotsRules = robots()) {
  const groups = rules.rules.map((rule) =>
    [
      ...[rule.userAgent].flat().map((agent) => `User-Agent: ${agent}`),
      ...(rule.allow ? [`Allow: ${rule.allow}`] : []),
      ...[rule.disallow ?? []].flat().map((path) => `Disallow: ${path}`),
    ].join("\n")
  );
  return `${groups.join("\n\n")}\n\nSitemap: ${rules.sitemap}\n`;
}
