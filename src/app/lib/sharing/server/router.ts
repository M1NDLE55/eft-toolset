import { planLive, shareLive } from "./live-routes";
import { getAdminReports, postAdminDecision, postReport } from "./report-routes";
import { deleteLink, getLinks, getShare, postLink, postShareCopy } from "./link-routes";
import {
  deletePlanMember,
  deletePlanRoute,
  getPlan,
  getPlanMembers,
  patchPlanMember,
  patchPlanSettings,
  postInviteAccept,
  postInvitePreview,
  postPlan,
  postPlanCopy,
  postPlanLeave,
  postPlanOps,
  postPlanTransfer,
} from "./plan-routes";
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
  { pattern: /^\/api\/plans$/, methods: { POST: postPlan } },
  { pattern: new RegExp(`^/api/plans/${SEGMENT}$`), methods: { GET: getPlan, DELETE: deletePlanRoute } },
  { pattern: new RegExp(`^/api/plans/${SEGMENT}/ops$`), methods: { POST: postPlanOps } },
  { pattern: new RegExp(`^/api/plans/${SEGMENT}/settings$`), methods: { PATCH: patchPlanSettings } },
  { pattern: new RegExp(`^/api/plans/${SEGMENT}/copy$`), methods: { POST: postPlanCopy } },
  { pattern: new RegExp(`^/api/plans/${SEGMENT}/members$`), methods: { GET: getPlanMembers } },
  { pattern: new RegExp(`^/api/plans/${SEGMENT}/members/([0-9a-f]{16})$`), methods: { PATCH: patchPlanMember, DELETE: deletePlanMember } },
  { pattern: new RegExp(`^/api/plans/${SEGMENT}/leave$`), methods: { POST: postPlanLeave } },
  { pattern: new RegExp(`^/api/plans/${SEGMENT}/transfer$`), methods: { POST: postPlanTransfer } },
  { pattern: /^\/api\/invites\/preview$/, methods: { POST: postInvitePreview } },
  { pattern: /^\/api\/invites\/accept$/, methods: { POST: postInviteAccept } },
  { pattern: /^\/api\/reports$/, methods: { POST: postReport } },
  { pattern: /^\/admin\/reports$/, methods: { GET: getAdminReports } },
  { pattern: /^\/admin\/reports\/((?:link|plan)(?::|%3A)[A-Za-z0-9_-]{1,64})$/, methods: { POST: postAdminDecision } },
];

/** WebSocket upgrade routes: served before the page cache, which can't carry a socket. */
const SOCKET_ROUTES: RouteDef[] = [
  { pattern: /^\/api\/library\/live$/, methods: { GET: libraryLive } },
  { pattern: new RegExp(`^/api/plans/${SEGMENT}/live$`), methods: { GET: planLive } },
  { pattern: new RegExp(`^/api/s/${CODE}/live$`), methods: { GET: shareLive } },
];

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
