import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The real Durable Object classes run in tests against an in-memory state (tests/helpers/durable-env.ts).
      "cloudflare:workers": fileURLToPath(new URL("./tests/helpers/cloudflare-workers.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    restoreMocks: true,
  },
});
