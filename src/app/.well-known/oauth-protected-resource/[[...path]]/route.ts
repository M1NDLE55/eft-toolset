import { mcpAuthConfig, protectedResourceMetadata } from "@/app/lib/mcp/auth";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=300",
};

/** RFC 9728, also at the path-suffixed URL clients try first. */
export function GET(request: Request) {
  const auth = mcpAuthConfig();
  const suffix = new URL(request.url).pathname.replace(/^\/\.well-known\/oauth-protected-resource/, "");
  if (!auth || (suffix !== "" && suffix !== new URL(auth.resource).pathname)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(protectedResourceMetadata(auth), { headers: HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}
