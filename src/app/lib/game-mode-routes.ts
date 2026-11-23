// Imported by next.config.ts, so it has no imports.

/** Where the PVE copies of mode-dependent pages live. Visitors never see these URLs. */
export const PVE_ROUTE_PREFIX = "/pve";

/**
 * Pages whose server render depends on the game mode. Each has a copy under PVE_ROUTE_PREFIX
 * that renders PVE data, and next.config.ts rewrites to it for visitors whose mode cookie says PVE.
 * Single-segment patterns, so a page's metadata images aren't rewritten.
 */
export const PVE_ROUTES = [
  "/item",
  "/item/:itemName",
  "/quests",
  "/quests/:slug",
  "/ammo",
  "/ammo/:caliber",
  "/keys/:map",
  "/gun-builder/best/:weapon",
  "/gun-builder/gunsmith/:task",
] as const;
