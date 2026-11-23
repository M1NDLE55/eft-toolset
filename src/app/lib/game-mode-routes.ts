// Imported by the Worker entry (src/server.ts) before anything else, so it has no imports.

/**
 * Where the old site kept internal PVE copies of mode-dependent pages. Pages now read the game mode
 * from the visitor's cookie at their own URL (src/app/lib/server/request-mode.ts); these URLs
 * redirect to the page.
 */
export const PVE_ROUTE_PREFIX = "/pve";

/** The path without the old PVE prefix, for anything rendered from the path. */
export function publicPathname(pathname: string): string {
  if (pathname === PVE_ROUTE_PREFIX) return "/";
  return pathname.startsWith(`${PVE_ROUTE_PREFIX}/`) ? pathname.slice(PVE_ROUTE_PREFIX.length) : pathname;
}
