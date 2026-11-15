/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  agentRules: false,
  reactCompiler: true,
  // get_wiki_page reads the wiki snapshot from disk, a page at a time. See DATA_ARCHITECTURE.md.
  outputFileTracingIncludes: { "/api/mcp": ["./data/wiki/**/*"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Loaded by a URL that carries the file's hash (see scripts/models), so it never changes.
        source: "/models/:path*",
        has: [{ type: "query", key: "v" }],
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
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
