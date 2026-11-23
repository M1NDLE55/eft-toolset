import type { NextConfig } from "next";
import { HSTS_HOST_PATTERN, HSTS_VALUE, securityHeaders } from "./src/app/lib/security/headers";
import { GAME_MODE_COOKIE } from "./src/components/game-mode/mode";
import { PVE_ROUTE_PREFIX, PVE_ROUTES } from "./src/app/lib/game-mode-routes";

// Every HTML route; the API routes set their own headers.
const PAGES = "/:path((?!api/|_next/).*)";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  reactCompiler: true,
  // get_wiki_page, item pages, quest pages and item.detail (what a key opens) read the wiki snapshot from disk, a page at a time. See DATA_ARCHITECTURE.md.
  // Every route that reads tarkov.dev data starts from, and falls back to, the snapshot written at build
  // time by scripts/build-tarkov-snapshot.mjs (about 4 MB). See DATA_ARCHITECTURE.md.
  outputFileTracingIncludes: {
    "/**": ["./data/tarkov/**/*"],
    "/api/mcp": ["./data/wiki/**/*"],
    "/api/tarkov": ["./data/wiki/item-ids.json", "./data/wiki/pages/**/*", "./data/wiki/items/**/*"],
    "/item/*": ["./data/wiki/index.json", "./data/wiki/item-ids.json", "./data/wiki/pages/**/*", "./data/wiki/items/**/*"],
    "/pve/item/*": ["./data/wiki/index.json", "./data/wiki/item-ids.json", "./data/wiki/pages/**/*", "./data/wiki/items/**/*"],
    "/sitemap.xml": ["./data/wiki/index.json"],
    "/quests/*": ["./data/wiki/index.json", "./data/wiki/image-credits.json", "./data/wiki/pages/**/*", "./assets/fonts/*.ttf"],
    "/pve/quests/*": ["./data/wiki/index.json", "./data/wiki/image-credits.json", "./data/wiki/pages/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      { source: "/", headers: securityHeaders() },
      { source: PAGES, headers: securityHeaders() },
      {
        source: PAGES,
        has: [{ type: "host", value: HSTS_HOST_PATTERN }],
        headers: [{ key: "Strict-Transport-Security", value: HSTS_VALUE }],
      },
      // Next sends these with max-age=0 and no shared max-age; both are rebuilt at most daily.
      ...["/sitemap.xml", "/robots.txt"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" }],
      })),
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
  async redirects() {
    // The PVE copies are reached only through the rewrites below; their own URLs go to the real page.
    return [
      { source: PVE_ROUTE_PREFIX, destination: "/", permanent: true },
      { source: `${PVE_ROUTE_PREFIX}/:path+`, destination: "/:path+", permanent: true },
    ];
  },
  async rewrites() {
    // A visitor in PVE mode gets the PVE copy of a page that renders mode-dependent data, so both
    // modes can be cached. This runs in Vercel's routing, without a middleware invocation.
    return {
      beforeFiles: PVE_ROUTES.map((source) => ({
        source,
        has: [{ type: "cookie" as const, key: GAME_MODE_COOKIE, value: "pve" }],
        destination: `${PVE_ROUTE_PREFIX}${source}`,
      })),
    };
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.tarkov.dev",
      },
    ],
  },
};

export default nextConfig;
