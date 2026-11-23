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

/**
 * The URL a visitor sees for a path, without the PVE prefix. Vercel renders a PVE copy, and
 * caches it, at its own path (/pve/item/…), while the browser shows /item/…: anything rendered
 * from the path must use this, or the server's HTML and the first client render disagree.
 */
export function publicPathname(pathname: string): string {
  if (pathname === PVE_ROUTE_PREFIX) return "/";
  return pathname.startsWith(`${PVE_ROUTE_PREFIX}/`) ? pathname.slice(PVE_ROUTE_PREFIX.length) : pathname;
}
