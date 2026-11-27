import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { NotFoundPage, RouteErrorPage } from "@/app/components/global/route-status";
import { handOverChunkErrors } from "@/app/lib/stale-build";

// Before any route's chunk loads: a chunk that doesn't download goes to RouteErrorPage.
if (typeof window !== "undefined") handOverChunkErrors();

/** Query strings are kept as plain strings, as URLSearchParams reads them; nothing is JSON-encoded. */
function parseSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search.startsWith("?") ? search.slice(1) : search));
}

function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getRouter() {
  return createRouter({
    routeTree,
    parseSearch,
    stringifySearch,
    scrollRestoration: true,
    defaultPreload: false,
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: RouteErrorPage,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
  interface StaticDataRouteOption {
    /** The route's head() emits the page's metadata (pageHead), so the root doesn't emit the site's. */
    pageHead?: boolean;
  }
}
