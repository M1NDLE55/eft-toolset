import { isGameMode } from "@/components/game-mode/mode";
import { fail, limitIp, requireSiteOrigin, route } from "@/app/lib/sharing/server/http";
import { platform } from "@/app/lib/server/platform";
import { PRICE_SOCKET_PATH } from "./live-protocol";

/**
 * GET /api/prices/live?mode=<regular|pve>: a page's live price socket, held by the mode's refresher
 * (data-refresh-do.ts). Anonymous: it carries only the public price version. The Origin must be this
 * site, and connects count against the per-IP socket limit like the plan sockets.
 */
export function priceSocketEndpoint(request: Request): ((request: Request) => Promise<Response>) | undefined {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return undefined;
  const url = new URL(request.url);
  if (url.pathname !== PRICE_SOCKET_PATH) return undefined;
  return (req) =>
    route(async () => {
      if (req.method !== "GET") fail("invalid", "Expected a GET.");
      requireSiteOrigin(req);
      await limitIp(req, "socket");
      const gameMode = url.searchParams.get("mode");
      if (!isGameMode(gameMode)) fail("invalid", "Unknown game mode.");
      const durable = platform().durable;
      if (!durable) fail("not_found", "Live prices aren't available here.");
      const headers = new Headers();
      for (const name of ["upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol"]) {
        const value = req.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      return durable.DATA_REFRESH.getByName(gameMode).fetch(new Request(`https://refresher.internal/live?mode=${gameMode}`, { headers }));
    });
}
