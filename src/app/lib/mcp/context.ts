import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  MCP_STALE_WAIT_MS,
  runTarkovRead,
  TarkovUpstreamError,
  type DataSnapshot,
  type DataSource,
  type PriceSourceInfo,
} from "@/app/lib/api/tarkov-server";
import { InputError } from "@/app/lib/input-error";
import type { GameMode } from "@/components/game-mode/mode";
import { readToolResult, storeToolResult } from "./result-cache";

export interface ToolContext {
  /** Origin used for links back into the app. */
  origin: string;
  /** Aborted when the HTTP request ends or the tool deadline passes. */
  signal: AbortSignal;
  /** Identifies the HTTP request in logs and in crash messages. */
  requestId: string;
  /**
   * The signed-in user's WorkOS user id (the access token's sub), for per-user data. Absent
   * only when sign-in is off, which production doesn't allow.
   */
  userId?: string;
}

/** Reads tarkov.dev data with the tool's cancellation and freshness tracking. */
export type Read = <T>(work: () => Promise<T>) => Promise<T>;

type ToolOutcome = "ok" | "input_error" | "upstream_error" | "timeout" | "crash";

const ERROR_MESSAGES: Record<Exclude<ToolOutcome, "ok" | "input_error">, string> = {
  upstream_error: "Tarkov.dev data is temporarily unavailable and this server has no copy of it yet.",
  timeout: "The request took too long and was stopped. Try a narrower request.",
  crash: "The tool failed unexpectedly.",
};

/** The error codes in a failed result's error object, for clients that branch on them. */
const ERROR_CODES: Record<Exclude<ToolOutcome, "ok">, string> = {
  input_error: "invalid_input",
  upstream_error: "upstream_unavailable",
  timeout: "timeout",
  crash: "internal_error",
};

/** Retry hint when the adapter gives none. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** Where a failed result's error object sits in _meta. */
export const ERROR_META_KEY = "eft-toolset/error";

/**
 * Runs a tool body and turns what it returns into a tool result: JSON text plus the same
 * object as structured content, with dataAsOf (when the tarkov.dev data it used was last
 * confirmed) and a dataNotice when that data was stale. Tool reads accept any copy the server
 * has when tarkov.dev can't be reached or is slow, and say how old it is, rather than failing.
 * Errors become tool errors the model can act on: a sentence, then the error object (code,
 * retryable, retryAfterSeconds) as JSON, also in _meta. Not in structuredContent: clients check
 * that against the tool's output schema even on errors. Logs one structured line per call.
 */
export async function runTool(
  context: ToolContext,
  call: { tool: string; gameMode?: GameMode; cacheKey?: string },
  body: (read: Read) => Promise<object>
): Promise<CallToolResult> {
  const startedAt = performance.now();
  let stale = false;
  let staleSource: DataSource = "tarkov.dev";
  let cached = false;
  let dataAgeMs: number | null = null;
  let prices: PriceSourceInfo | null = null;
  const snapshots: DataSnapshot[] = [];
  const read: Read = (work) =>
    runTarkovRead(work, {
      signal: context.signal,
      maxStaleMs: Number.POSITIVE_INFINITY,
      staleWaitMs: MCP_STALE_WAIT_MS,
      onStale: ({ source }) => {
        stale = true;
        if (source === "deployment") staleSource = source;
      },
      onDataAge: (ageMs) => {
        dataAgeMs = Math.max(dataAgeMs ?? 0, ageMs);
      },
      onPriceSource: (info) => {
        if (!prices || info.ageMs > prices.ageMs) prices = info;
      },
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });
  let outcome: ToolOutcome = "ok";
  try {
    const hit = call.cacheKey ? readToolResult(call.cacheKey) : undefined;
    if (hit) {
      cached = true;
      return toolResult(hit);
    }
    const result = await body(read);
    const payload: Record<string, unknown> = { ...result };
    if (dataAgeMs !== null) payload.dataAsOf = new Date(Date.now() - dataAgeMs).toISOString();
    if (stale) payload.dataNotice = staleNotice(dataAgeMs, staleSource);
    if (prices) payload.priceSource = priceSource(prices);
    if (call.cacheKey && !stale) storeToolResult(call.cacheKey, payload, snapshots.flat());
    return toolResult(payload);
  } catch (error) {
    outcome = classifyError(error, context);
    if (outcome === "crash") console.error(`MCP ${call.tool} failed (request ${context.requestId})`, error);
    const retryAfterSeconds =
      outcome === "upstream_error"
        ? Math.max(1, Math.ceil(((error as TarkovUpstreamError).retryAfterMs ?? DEFAULT_RETRY_AFTER_SECONDS * 1000) / 1000))
        : null;
    const message =
      outcome === "input_error"
        ? (error as Error).message
        : outcome === "crash"
          ? `${ERROR_MESSAGES.crash} Reference: ${context.requestId}.`
          : outcome === "upstream_error"
            ? `${ERROR_MESSAGES.upstream_error} Try again in ${retryAfterSeconds} seconds.`
            : ERROR_MESSAGES[outcome];
    const details = {
      code: ERROR_CODES[outcome],
      // Input errors need a different request; a crash is a bug, so the same call would fail again.
      retryable: outcome === "upstream_error" || outcome === "timeout",
      ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
    };
    return {
      isError: true,
      content: [
        { type: "text", text: message },
        { type: "text", text: JSON.stringify({ error: details }) },
      ],
      _meta: { [ERROR_META_KEY]: details },
    };
  } finally {
    console.info(
      JSON.stringify({
        event: "mcp_tool_call",
        requestId: context.requestId,
        tool: call.tool,
        signedIn: context.userId !== undefined,
        gameMode: call.gameMode ?? null,
        outcome,
        durationMs: Math.round(performance.now() - startedAt),
        stale,
        dataAgeSeconds: dataAgeMs === null ? null : Math.round(dataAgeMs / 1000),
        cached,
      })
    );
  }
}

function toolResult(payload: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
}

/** Prices newer than this, from a copy whose refresh didn't fail, count as live: tarkov.dev rebuilds them every 5 minutes. */
const LIVE_PRICE_AGE_MS = 5 * 60_000;

/** Where a result's prices came from: live, a cached copy, or the copy bundled with the server, and how old they are. */
function priceSource({ source, ageMs, stale }: PriceSourceInfo) {
  const kind = source === "snapshot" ? "snapshot" : !stale && ageMs <= LIVE_PRICE_AGE_MS ? "live" : "cached";
  return { kind, ageSeconds: Math.round(ageMs / 1000) };
}

function staleNotice(dataAgeMs: number | null, source: DataSource) {
  const minutes = dataAgeMs === null ? null : Math.max(1, Math.round(dataAgeMs / 60_000));
  const age =
    minutes === null
      ? ""
      : ` from about ${
          minutes < 90
            ? `${minutes} minute${minutes === 1 ? "" : "s"}`
            : minutes < 48 * 60
              ? `${Math.round(minutes / 60)} hours`
              : `${Math.round(minutes / (24 * 60))} days`
        } ago`;
  const copy = source === "deployment" ? "the copy bundled with this server" : "cached data";
  return `Fresh tarkov.dev data couldn't be fetched in time, so this uses ${copy}${age}. Prices may have changed.`;
}

function classifyError(error: unknown, context: ToolContext): Exclude<ToolOutcome, "ok"> {
  if (error instanceof InputError) return "input_error";
  if (error instanceof TarkovUpstreamError) return "upstream_error";
  const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  if (context.signal.aborted || aborted) return "timeout";
  // Anything else is a bug, including the adapter rejecting a request (TarkovRequestError),
  // since tools validate their own input.
  return "crash";
}

const nextTurn: (callback: () => void) => void =
  typeof setImmediate === "function" ? (callback) => setImmediate(callback) : (callback) => setTimeout(callback, 0);

/**
 * Lets other requests run between the items of a long list, then stops if the request has
 * ended or its deadline has passed. Synchronous work can't be interrupted, so loops over
 * many inputs call this between inputs.
 */
export async function betweenItems(signal: AbortSignal) {
  await new Promise<void>((resolve) => nextTurn(resolve));
  signal.throwIfAborted();
}

export function round(value: number | null | undefined, digits = 0): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export { InputError };
export type { GameMode };
