import { GET as tarkovGet, POST as tarkovPost } from "@/app/lib/api/tarkov-route";
import { authCallback, deleteAccount, devSignIn, getAccount, signIn, signInWithIntent, signOut } from "@/app/lib/account/routes";
import { PROTECTED_RESOURCE_PATH, protectedResourceGet, protectedResourceOptions } from "@/app/lib/mcp/protected-resource";
import sitemap, { sitemapXml } from "@/app/lib/seo/sitemap";
import { robotsTxt } from "@/app/lib/seo/robots";
import { questOgImage } from "@/app/quests/quest-og-image";
import { EDGE_TTL, EDGE_TTL_HEADER } from "./edge-cache";
import { sharingEndpoint } from "@/app/lib/sharing/server/router";

type Handler = (request: Request) => Response | Promise<Response>;

// Crawlers fetch these at most daily; both are rebuilt daily.
const CRAWLER_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  "/api/tarkov": { GET: tarkovGet, POST: tarkovPost },
  "/api/account": { GET: getAccount, DELETE: deleteAccount },
  "/api/account/sign-out": { POST: signOut },
  "/auth/sign-in": { GET: signIn, POST: signInWithIntent },
  "/auth/callback": { GET: authCallback },
  "/auth/dev-sign-in": { GET: devSignIn },
  "/sitemap.xml": {
    GET: async () =>
      new Response(sitemapXml(await sitemap()), {
        headers: { "Content-Type": "application/xml", "Cache-Control": CRAWLER_CACHE_CONTROL, [EDGE_TTL_HEADER]: String(EDGE_TTL.daily) },
      }),
  },
  "/robots.txt": {
    GET: () =>
      new Response(robotsTxt(), {
        headers: { "Content-Type": "text/plain", "Cache-Control": CRAWLER_CACHE_CONTROL, [EDGE_TTL_HEADER]: String(EDGE_TTL.static) },
      }),
  },
};

const QUEST_IMAGE = /^\/quests\/([^/]+)\/(?:opengraph|twitter)-image$/;

function methodNotAllowed(allowed: string[]) {
  return new Response(null, { status: 405, headers: { Allow: allowed.join(", "), "Cache-Control": "no-store" } });
}

/**
 * The site's endpoints that aren't pages: the data API, account and sign-in routes, OAuth
 * protected-resource metadata, the sitemap, robots.txt and quest share images. Undefined for any
 * other path, which TanStack Start serves.
 */
export function endpointFor(request: Request): Handler | undefined {
  const { pathname } = new URL(request.url);
  const routes = ROUTES[pathname];
  if (routes) return routes[request.method] ?? (() => methodNotAllowed(Object.keys(routes)));
  const sharing = sharingEndpoint(request);
  if (sharing) return sharing;

  if (pathname === PROTECTED_RESOURCE_PATH || pathname.startsWith(`${PROTECTED_RESOURCE_PATH}/`)) {
    if (request.method === "GET") return protectedResourceGet;
    if (request.method === "OPTIONS") return protectedResourceOptions;
    return () => methodNotAllowed(["GET", "OPTIONS"]);
  }

  const quest = QUEST_IMAGE.exec(pathname);
  if (quest && request.method === "GET") {
    return async () => {
      const response = await questOgImage(decodeURIComponent(quest[1]));
      // Share images are kept at the edge like the quest page they belong to.
      if (response.status === 200) response.headers.set(EDGE_TTL_HEADER, String(EDGE_TTL.daily));
      return response;
    };
  }
  return undefined;
}
