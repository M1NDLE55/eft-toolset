import { cp, readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { DATA_ASSET_PREFIX } from "./src/app/lib/server/data-asset-prefix";
import { PRERENDERED_PAGES } from "./src/app/lib/seo/prerendered-pages";

const root = fileURLToPath(new URL(".", import.meta.url));
const dataDir = resolve(root, "data");

/**
 * The wiki snapshot (data/wiki), the share-image fonts (data/fonts) and the tarkov.dev snapshot (data/tarkov, written by
 * scripts/build-tarkov-snapshot.mjs) ship as static assets under /_data/, which the Worker reads
 * through its ASSETS binding and refuses to serve publicly. In development the same paths are
 * served from data/ directly.
 */
function dataSnapshotAssets(): Plugin {
  return {
    name: "eft:data-snapshot-assets",
    configureServer(server) {
      server.middlewares.use(DATA_ASSET_PREFIX, async (req, res, next) => {
        const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
        const file = join(dataDir, path);
        if (!file.startsWith(dataDir + "/")) return next();
        try {
          if (!(await stat(file)).isFile()) return next();
          res.setHeader("Content-Type", extname(file) === ".json" ? "application/json" : "application/octet-stream");
          res.end(await readFile(file));
        } catch {
          next();
        }
      });
    },
    applyToEnvironment: (environment) => environment.name === "client",
    async writeBundle(options) {
      if (!options.dir) return;
      for (const name of ["wiki", "tarkov", "fonts"]) {
        const source = join(dataDir, name);
        try {
          await stat(source);
        } catch {
          continue;
        }
        await cp(source, join(options.dir, DATA_ASSET_PREFIX, name), { recursive: true });
      }
    },
  };
}

/** Names this build, so the edge page cache never mixes two deployments' pages. */
const BUILD_ID = process.env.EFT_BUILD_ID ?? `${Date.now().toString(36)}`;

export default defineConfig({
  define: {
    "import.meta.env.EFT_BUILD_ID": JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: { "@": resolve(root, "src") },
  },
  server: { port: 3000 },
  plugins: [
    dataSnapshotAssets(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: process.env.EFT_PRERENDER !== "0",
        crawlLinks: false,
        autoSubfolderIndex: false,
        failOnError: true,
        filter: ({ path }) => (PRERENDERED_PAGES as readonly string[]).includes(path),
      },
      pages: PRERENDERED_PAGES.map((path) => ({ path, prerender: { enabled: true } })),
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});
