import { cp, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { CLIENT_BUILD_TARGET, findTooNewApis } from "./scripts/browser-support.mjs";
import { DATA_ASSET_PREFIX } from "./src/app/lib/server/data-asset-prefix.ts";
import { PRERENDERED_PAGES } from "./src/app/lib/seo/prerendered-pages.ts";
import { staticAssetHeaders } from "./src/app/lib/security/static-headers.ts";

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

/**
 * Static assets (prerendered pages, scripts, images) are served without running the Worker, so
 * their headers come from the assets' _headers file: the same security headers the Worker sets.
 */
function staticHeaders(): Plugin {
  return {
    name: "eft:static-headers",
    applyToEnvironment: (environment) => environment.name === "client",
    async writeBundle(options) {
      if (options.dir) await writeFile(join(options.dir, "_headers"), staticAssetHeaders());
    },
  };
}

/**
 * Fails the client build when browser code calls a built-in that Chrome 109 lacks (see
 * scripts/browser-support.mjs). The build target lowers syntax only, so a call like
 * `array.toSorted()` from our code or a dependency would otherwise throw on older browsers.
 */
function browserSupportCheck(): Plugin {
  return {
    name: "eft:browser-support-check",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle(_options, bundle) {
      const problems: string[] = [];
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const [id, module] of Object.entries(output.modules)) {
          for (const found of findTooNewApis(module.code ?? "", id)) {
            problems.push(`${id}: ${found.api} needs Chrome ${found.chrome}; use ${found.instead}`);
          }
        }
      }
      if (problems.length > 0) {
        this.error(`Browser code uses built-ins newer than Chrome 109:\n${problems.map((line) => `  ${line}`).join("\n")}`);
      }
    },
  };
}

/** Names this build, so the edge page cache never mixes two deployments' pages. */
const BUILD_ID = process.env.EFT_BUILD_ID ?? `${Date.now().toString(36)}`;

export default defineConfig({
  define: {
    "import.meta.env.EFT_BUILD_ID": JSON.stringify(BUILD_ID),
    // Local end-to-end runs of a built bundle under `wrangler dev` (EFT_LOCAL_E2E=1 at build time):
    // keeps the development sign-in, which still needs DEV_AUTH=1 at runtime. Never set for deploys.
    "import.meta.env.EFT_LOCAL_E2E": JSON.stringify(process.env.EFT_LOCAL_E2E === "1"),
  },
  resolve: {
    alias: { "@": resolve(root, "src") },
  },
  server: { port: 3000 },
  environments: {
    // Vite's default browser target (Baseline widely available) starts at Chrome 111. Chrome 109 is the
    // last release for Windows 7 and 8.1, so the browser bundle's syntax is lowered for it too.
    // Built-in methods are not polyfilled: browserSupportCheck() keeps the too-new ones out.
    client: { build: { target: CLIENT_BUILD_TARGET } },
  },
  plugins: [
    dataSnapshotAssets(),
    staticHeaders(),
    browserSupportCheck(),
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
