import { mcpAuthConfig, protectedResourceMetadata } from "./auth";

export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=300",
};

/** RFC 9728, also at the path-suffixed URL clients try first. */
export function protectedResourceGet(request: Request) {
  const auth = mcpAuthConfig();
  const suffix = new URL(request.url).pathname.replace(/^\/\.well-known\/oauth-protected-resource/, "");
  if (!auth || (suffix !== "" && suffix !== new URL(auth.resource).pathname)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(protectedResourceMetadata(auth), { headers: HEADERS });
}

export function protectedResourceOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}
