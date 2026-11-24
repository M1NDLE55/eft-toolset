import { deleteLink, getLinks, getShare, postLink, postShareCopy } from "./link-routes";
import { getLibrary, getLibraryChanges, libraryLive, patchItemSettings, patchProfile, postImport, postMutations, postNoticesRead } from "./library-routes";

type Handler = (request: Request, ...params: string[]) => Response | Promise<Response>;

interface RouteDef {
  pattern: RegExp;
  methods: Partial<Record<string, Handler>>;
}

const SEGMENT = "([A-Za-z0-9_-]{1,64})";
const CODE = "([1-9A-Za-z][A-Za-z0-9_-]{20})";

/** The sharing, sync and hosting routes (§10), by path pattern. */
const ROUTES: RouteDef[] = [
  { pattern: /^\/api\/library$/, methods: { GET: getLibrary } },
  { pattern: /^\/api\/library\/changes$/, methods: { GET: getLibraryChanges } },
  { pattern: /^\/api\/library\/mutations$/, methods: { POST: postMutations } },
  { pattern: /^\/api\/library\/import$/, methods: { POST: postImport } },
  { pattern: new RegExp(`^/api/library/(builds|item-groups)/${SEGMENT}/settings$`), methods: { PATCH: patchItemSettings } },
  { pattern: /^\/api\/profile$/, methods: { PATCH: patchProfile } },
  { pattern: /^\/api\/notices\/read$/, methods: { POST: postNoticesRead } },
  { pattern: /^\/api\/links$/, methods: { GET: getLinks, POST: postLink } },
  { pattern: new RegExp(`^/api/links/${CODE}$`), methods: { DELETE: deleteLink } },
  { pattern: new RegExp(`^/api/s/${CODE}$`), methods: { GET: getShare } },
  { pattern: new RegExp(`^/api/s/${CODE}/copy$`), methods: { POST: postShareCopy } },
];

/** WebSocket upgrade routes: served before the page cache, which can't carry a socket. */
const SOCKET_ROUTES: RouteDef[] = [{ pattern: /^\/api\/library\/live$/, methods: { GET: libraryLive } }];

function match(routes: RouteDef[], request: Request): Handler | undefined {
  const { pathname } = new URL(request.url);
  for (const definition of routes) {
    const found = definition.pattern.exec(pathname);
    if (!found) continue;
    const handler = definition.methods[request.method];
    const params = found.slice(1);
    if (!handler) {
      return () =>
        new Response(null, { status: 405, headers: { Allow: Object.keys(definition.methods).join(", "), "Cache-Control": "no-store" } });
    }
    return (req) => handler(req, ...params);
  }
  return undefined;
}

export function sharingEndpoint(request: Request): ((request: Request) => Response | Promise<Response>) | undefined {
  return match(ROUTES, request);
}

export function sharingSocketEndpoint(request: Request): ((request: Request) => Response | Promise<Response>) | undefined {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return undefined;
  return match(SOCKET_ROUTES, request);
}
