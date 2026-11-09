import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { consumeRequestBudget } from "@/app/lib/api/rate-limit";
import {
  RequestBodyBusyError,
  RequestBodyTooLargeError,
  readBodyWithLimit,
} from "@/app/lib/api/request-body";
import { releaseOperationSlot, tryAcquireOperationSlot } from "@/app/lib/api/tarkov-server";
import { SITE_ORIGIN } from "@/app/lib/site";
import { createEftMcpServer } from "./server";

export interface McpHttpLimits {
  /** Two maximum-length share links (compare_builds) fit with room to spare. */
  maxRequestBytes: number;
  /** Tools stop at this deadline and return an error result the model can act on. */
  toolDeadlineMs: number;
  /**
   * Tool calls running at once on this server instance, which leaves most of its operation
   * pool for the website. Rate limits, not this cap, bound the service as a whole.
   */
  maxConcurrentToolCalls: number;
}

export const DEFAULT_MCP_LIMITS: McpHttpLimits = {
  maxRequestBytes: 1024 * 1024,
  toolDeadlineMs: 40_000,
  maxConcurrentToolCalls: 6,
};

// Rate-limit tokens per request: tool calls cost more than handshakes and lists, and the
// tools that run the optimiser cost most.
const BASE_COST = 0.2;
const TOOL_CALL_COST = 1;
const TOOL_COSTS: Record<string, number> = { optimize_build: 3, modify_build: 2 };

let activeToolCalls = 0;

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Origin",
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

interface JsonRpcMessage {
  method?: unknown;
  id?: unknown;
  params?: { name?: unknown };
}

/**
 * Handles one stateless MCP POST: origin check, body limit, rate limit, a concurrency slot
 * for tool calls, then a fresh server and transport that answer with JSON.
 */
export async function handleMcpPost(request: Request, limits: McpHttpLimits = DEFAULT_MCP_LIMITS) {
  const cors = corsHeaders(request);
  if (!cors) return jsonRpcError(null, 403, -32000, "Requests from this origin are not allowed.");

  const parsed = await readMessage(request, limits, cors);
  const message = parsed instanceof Response ? null : parsed;
  const isToolCall = message?.method === "tools/call";
  const toolName = typeof message?.params?.name === "string" ? message.params.name : "";
  // Requests that can't be read still cost the base amount.
  const budget = consumeRequestBudget(request, isToolCall ? (TOOL_COSTS[toolName] ?? TOOL_CALL_COST) : BASE_COST, "mcp");
  if (!budget.allowed) {
    return jsonRpcError(cors, 429, -32000, "Too many requests.", { "Retry-After": String(budget.retryAfterSeconds) });
  }
  if (!message) return parsed as Response;

  // A stateless server has nothing to do with a notification.
  if (typeof message.method === "string" && !("id" in message)) {
    return new Response(null, { status: 202, headers: { ...BASE_HEADERS, ...cors } });
  }
  if (isToolCall && !acquireSlot(limits)) return busy(cors);

  const requestId = crypto.randomUUID().slice(0, 8);
  const server = createEftMcpServer({
    origin: linkOrigin(request),
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(limits.toolDeadlineMs)]),
    requestId,
  });
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: message });
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries({ ...BASE_HEADERS, ...cors })) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error(`MCP request ${requestId} failed`, error);
    const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
    return jsonRpcError(cors, 500, -32603, `Internal error. Reference: ${requestId}.`, {}, id);
  } finally {
    if (isToolCall) releaseSlot();
    void server.close().catch(() => undefined);
  }
}

/** The request's single JSON-RPC message, or the response that explains why it can't be read. */
async function readMessage(
  request: Request,
  limits: McpHttpLimits,
  cors: Record<string, string>
): Promise<JsonRpcMessage | Response> {
  let rawBody: string;
  try {
    rawBody = await readBodyWithLimit(request, limits.maxRequestBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      const limit = `${Math.round(limits.maxRequestBytes / 1024)} KiB`;
      return jsonRpcError(cors, 413, -32600, `Request body is larger than ${limit}. Send fewer or shorter share links per call.`);
    }
    if (error instanceof RequestBodyBusyError) return busy(cors);
    return jsonRpcError(cors, 400, -32700, "Request body could not be read.");
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonRpcError(cors, 400, -32700, "Parse error: the body must be JSON-RPC.");
  }
  // MCP dropped JSON-RPC batches in 2025-06-18, and no current client sends them.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonRpcError(cors, 400, -32600, "Send one JSON-RPC message per request.");
  }
  return body;
}

export function mcpMethodNotAllowed(request: Request) {
  return jsonRpcError(corsHeaders(request) ?? {}, 405, -32000, "This MCP server is stateless. Send JSON-RPC messages with POST.", {
    Allow: "POST, OPTIONS",
  });
}

export function mcpPreflight(request: Request) {
  const cors = corsHeaders(request);
  return new Response(null, { status: cors ? 204 : 403, headers: { ...BASE_HEADERS, ...cors } });
}

function busy(cors: Record<string, string>) {
  return jsonRpcError(cors, 429, -32000, "The service is busy. Try again shortly.", { "Retry-After": "1" });
}

function jsonRpcError(
  cors: Record<string, string> | null,
  status: number,
  code: number,
  message: string,
  extraHeaders: Record<string, string> = {},
  id: string | number | null = null
) {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id },
    { status, headers: { ...BASE_HEADERS, ...cors, ...extraHeaders } }
  );
}

function acquireSlot(limits: McpHttpLimits) {
  if (activeToolCalls >= limits.maxConcurrentToolCalls || !tryAcquireOperationSlot()) return false;
  activeToolCalls += 1;
  return true;
}

function releaseSlot() {
  activeToolCalls -= 1;
  releaseOperationSlot();
}

/**
 * CORS headers for the request, or null when its origin is not allowed. Browsers send
 * Origin; other clients usually don't. Allowed: no Origin, this site, and local development
 * tools such as the MCP Inspector.
 */
function corsHeaders(request: Request): Record<string, string> | null {
  const origin = request.headers.get("origin");
  if (!origin) return CORS_HEADERS;
  return isAllowedOrigin(origin) ? { ...CORS_HEADERS, "Access-Control-Allow-Origin": origin } : null;
}

function isAllowedOrigin(origin: string) {
  if (origin === SITE_ORIGIN) return true;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * The origin for links in tool results. Production uses the canonical site, so request
 * headers never decide where links point; development uses the request's own origin.
 */
function linkOrigin(request: Request) {
  return process.env.NODE_ENV === "production" ? SITE_ORIGIN : new URL(request.url).origin;
}
