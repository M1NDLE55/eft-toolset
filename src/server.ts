import { env } from "cloudflare:workers";
import handler from "@tanstack/react-start/server-entry";
import { installWorkerPlatform } from "@/app/lib/server/worker-platform";
import { withSecurityHeaders } from "@/app/lib/security/apply";
import { servePage } from "@/app/lib/server/page-cache";
import { endpointFor } from "@/app/lib/server/endpoints";
import { handleMcpRequest } from "@/app/lib/mcp/http";
import { runScheduledRefresh } from "@/app/lib/api/scheduled";
import { DATA_ASSET_PREFIX } from "@/app/lib/server/data-asset-prefix";
import { PVE_ROUTE_PREFIX } from "@/app/lib/game-mode-routes";
import { sharingSocketEndpoint } from "@/app/lib/sharing/server/router";

export { UserDO } from "@/app/lib/durable/user-do";
export { PlanDO } from "@/app/lib/durable/plan-do";
export { LinkDO } from "@/app/lib/durable/link-do";
export { ModerationDO } from "@/app/lib/durable/moderation-do";

installWorkerPlatform(env);

const MCP_PATH = "/api/mcp";

/**
 * Every request the static assets don't answer. Order: the private data snapshot, the old PVE copy
 * URLs, the MCP endpoint, then the other endpoints (src/app/lib/server/endpoints.ts) and TanStack
 * Start's pages and server functions, cached at the edge where they say so and given the site's
 * security headers.
 */
async function fetchHandler(request: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
  installWorkerPlatform(env, ctx, request);
  const url = new URL(request.url);

  if (url.pathname === DATA_ASSET_PREFIX || url.pathname.startsWith(`${DATA_ASSET_PREFIX}/`)) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  // The PVE copies used to have their own URLs; they always redirected to the real page.
  if (url.pathname === PVE_ROUTE_PREFIX || url.pathname.startsWith(`${PVE_ROUTE_PREFIX}/`)) {
    const target = new URL(url);
    target.pathname = url.pathname.slice(PVE_ROUTE_PREFIX.length) || "/";
    return withSecurityHeaders(request, Response.redirect(target.href, 308));
  }

  if (url.pathname === MCP_PATH) return handleMcpRequest(request);

  // Live sockets (plans, the library change feed) go straight to their Durable Object.
  const socket = sharingSocketEndpoint(request);
  if (socket) return socket(request);

  const response = await servePage(request, ctx, async (pageRequest) => {
    const endpoint = endpointFor(pageRequest);
    return endpoint ? endpoint(pageRequest) : handler.fetch(pageRequest);
  });
  return withSecurityHeaders(request, response);
}

export default {
  fetch: fetchHandler,
  async scheduled(controller: ScheduledController, _env: Env, ctx: ExecutionContext) {
    installWorkerPlatform(env, ctx);
    await runScheduledRefresh(controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
