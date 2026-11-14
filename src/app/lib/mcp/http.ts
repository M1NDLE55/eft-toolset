import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { clientIp } from "@/app/lib/api/rate-limit";
import {
  RequestBodyBusyError,
  RequestBodyTooLargeError,
  readBodyWithLimit,
} from "@/app/lib/api/request-body";
import { releaseOperationSlot, tryAcquireOperationSlot } from "@/app/lib/api/tarkov-server";
import { SITE_ORIGIN } from "@/app/lib/site";
import {
  identifyCaller,
  isChatGptRequest,
  mcpAuthConfig,
  OPTIONAL_OAUTH_SECURITY_SCHEMES,
  signInToolResult,
  wwwAuthenticate,
  type ChallengeReason,
  type McpAuthConfig,
} from "./auth";
import { chargeMcpBudget, type McpBudget, type Payer } from "./budget";
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
// tools that run the optimiser cost most. The base cost is a binary fraction so that the two
// charges of a tool call add up exactly.
const BASE_COST = 0.25;
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

const AUTH_CORS_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Protocol-Version, Authorization",
  "Access-Control-Expose-Headers": "Mcp-Protocol-Version, WWW-Authenticate",
};

interface JsonRpcMessage {
  method?: unknown;
  id?: unknown;
  params?: { name?: unknown; _meta?: unknown };
}

export async function handleMcpPost(request: Request, limits: McpHttpLimits = DEFAULT_MCP_LIMITS) {
  const auth = mcpAuthConfig();
  const cors = corsHeaders(request, auth);
  if (!cors) return jsonRpcError(null, 403, -32000, "Requests from this origin are not allowed.");

  const caller = await identifyCaller(request, auth);
  if (caller.kind === "unverifiable") {
    return jsonRpcError(cors, 503, -32000, "Sign-in can't be checked right now. Try again shortly.", { "Retry-After": "5" });
  }
  // Never rate limited: the challenge is what makes clients refresh. The body is read only to
  // tell a ChatGPT tool call, which needs its challenge in a tool result, from the rest.
  if (caller.kind === "invalid" && auth) {
    return authChallenge(request, auth, cors, "invalid_token", await readMessageIfPossible(request, limits, cors));
  }
  const payer: Payer = caller.kind === "user" ? caller : { kind: "anonymous", ip: clientIp(request) };
  const limited = async (budget: McpBudget, message: JsonRpcMessage | null) => {
    if (auth && payer.kind === "anonymous" && budget.limitedBy === "payer") {
      return authChallenge(request, auth, cors, "sign_in", message ?? (await readMessageIfPossible(request, limits, cors)));
    }
    return jsonRpcError(cors, 429, -32000, "Too many requests.", { "Retry-After": String(budget.retryAfterSeconds) });
  };

  // Every request pays the base cost before its body is read, so a client over its budget
  // can't keep body reads busy. Tool calls pay the rest once the body shows which tool it is,
  // and get the base cost back if they can't, so parallel calls near the limit don't spend
  // the budget on calls that never run.
  const base = await chargeMcpBudget(payer, BASE_COST);
  if (!base.allowed) return limited(base, null);
  const message = await readMessage(request, limits, cors);
  if (message instanceof Response) return message;
  const isToolCall = message.method === "tools/call";
  if (isToolCall) {
    const toolName = typeof message.params?.name === "string" ? message.params.name : "";
    const tool = await chargeMcpBudget(payer, (TOOL_COSTS[toolName] ?? TOOL_CALL_COST) - BASE_COST, BASE_COST);
    if (!tool.allowed) return limited(tool, message);
  }

  // A stateless server has nothing to do with a notification.
  if (typeof message.method === "string" && !("id" in message)) {
    return new Response(null, { status: 202, headers: { ...BASE_HEADERS, ...cors } });
  }
  if (isToolCall && !acquireSlot(limits)) return busy(cors);

  const requestId = crypto.randomUUID().slice(0, 8);
  const server = createEftMcpServer(
    {
      origin: linkOrigin(request),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(limits.toolDeadlineMs)]),
      requestId,
      signedIn: payer.kind === "user",
    },
    { securitySchemes: auth ? OPTIONAL_OAUTH_SECURITY_SCHEMES : undefined }
  );
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

/**
 * Asks the client to sign in, in the shape it acts on. ChatGPT documents a tool result
 * carrying _meta["mcp/www_authenticate"] (HTTP 200) as what starts sign-in during a tool call,
 * and OpenAI advises against relying on a 401 there. Claude starts sign-in from a 401 with
 * WWW-Authenticate on any request and passes a 200 tool error to the model as text, as do the
 * MCP SDK clients that Cursor and others follow. So ChatGPT's tool calls get the tool result
 * and everything else, including unknown clients, gets the spec's 401.
 */
function authChallenge(
  request: Request,
  auth: McpAuthConfig,
  cors: Record<string, string>,
  reason: ChallengeReason,
  message: JsonRpcMessage | null
) {
  const id = typeof message?.id === "string" || typeof message?.id === "number" ? message.id : null;
  if (message?.method === "tools/call" && id !== null && isChatGptRequest(request, message.params)) {
    return Response.json(
      { jsonrpc: "2.0", id, result: signInToolResult(auth, reason) },
      { headers: { ...BASE_HEADERS, ...cors } }
    );
  }
  const headers = { ...BASE_HEADERS, ...cors, "WWW-Authenticate": wwwAuthenticate(auth, reason) };
  const text = reason === "sign_in" ? "Sign in to keep using EFT Toolset." : "The access token is expired or invalid.";
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: text }, id }, { status: 401, headers });
}

async function readMessageIfPossible(request: Request, limits: McpHttpLimits, cors: Record<string, string>) {
  const message = await readMessage(request, limits, cors);
  return message instanceof Response ? null : message;
}

/** The request's single JSON-RPC message, or the response that explains why it can't be read. */
async function readMessage(
  request: Request,
  limits: McpHttpLimits,
  cors: Record<string, string>
): Promise<JsonRpcMessage | Response> {
  let rawBody: string;
  try {
    rawBody = await readBodyWithLimit(request, limits.maxRequestBytes, "mcp");
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
  return jsonRpcError(corsHeaders(request, mcpAuthConfig()) ?? {}, 405, -32000, "This MCP server is stateless. Send JSON-RPC messages with POST.", {
    Allow: "POST, OPTIONS",
  });
}

export function mcpPreflight(request: Request) {
  const cors = corsHeaders(request, mcpAuthConfig());
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
function corsHeaders(request: Request, auth: McpAuthConfig | null): Record<string, string> | null {
  const base = auth ? AUTH_CORS_HEADERS : CORS_HEADERS;
  const origin = request.headers.get("origin");
  if (!origin) return base;
  return isAllowedOrigin(origin) ? { ...base, "Access-Control-Allow-Origin": origin } : null;
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
