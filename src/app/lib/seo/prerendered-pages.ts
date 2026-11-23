// Imported by vite.config.ts, so it has no imports.

/**
 * Pages whose HTML depends on nothing but the code: they are rendered at build time and served as
 * static assets, without running the Worker. Everything on them that varies (saved data, the game
 * mode, the signed-in state) is read in the browser.
 */
export const PRERENDERED_PAGES = [
  "/",
  "/credits",
  "/policies/disclaimer-and-use-policy",
  "/mcp",
  "/settings",
  "/data",
  "/gun-builder",
  "/gun-builder/compare",
  "/item-groups",
  "/raid-planner",
] as const;
