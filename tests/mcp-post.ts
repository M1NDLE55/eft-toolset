import { handleMcpPost } from "@/app/lib/mcp/http";

/**
 * POST /api/mcp, with an SSE answer turned back into its JSON-RPC message. The Agents SDK answers
 * 2025-era clients over SSE (one event carrying the response); tests read the message as JSON.
 */
export async function mcpPost(request: Request, limits?: Parameters<typeof handleMcpPost>[1]): Promise<Response> {
  const response = await handleMcpPost(request, limits);
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return response;
  const text = await response.text();
  const message = text
    .split(/\r?\n\r?\n/)
    .map((event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n"))
    .filter(Boolean)
    .map((data) => JSON.parse(data) as { result?: unknown; error?: unknown })
    .find((entry) => "result" in entry || "error" in entry);
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(message ?? null), { status: response.status, headers });
}
