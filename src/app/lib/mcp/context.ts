import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runTarkovRead, TarkovUpstreamError } from "@/app/lib/api/tarkov-server";
import { InputError } from "@/app/lib/input-error";
import type { GameMode } from "@/components/game-mode/mode";

export interface ToolContext {
  /** Origin used for links back into the app. */
  origin: string;
  /** Aborted when the HTTP request ends or the tool deadline passes. */
  signal: AbortSignal;
  /** Identifies the HTTP request in logs and in crash messages. */
  requestId: string;
}

/** Reads tarkov.dev data with the tool's cancellation and freshness tracking. */
export type Read = <T>(work: () => Promise<T>) => Promise<T>;

type ToolOutcome = "ok" | "input_error" | "upstream_error" | "timeout" | "crash";

const ERROR_MESSAGES: Record<Exclude<ToolOutcome, "ok" | "input_error">, string> = {
  upstream_error: "Tarkov.dev data is temporarily unavailable. Try again in a few seconds.",
  timeout: "The request took too long and was stopped. Try a narrower request.",
  crash: "The tool failed unexpectedly.",
};

/**
 * Runs a tool body and turns what it returns into a tool result: JSON text plus the same
 * object as structured content, with a dataNotice when the data was stale. Errors become
 * tool errors the model can act on. Logs one structured line per call.
 */
export async function runTool(
  context: ToolContext,
  call: { tool: string; gameMode?: GameMode },
  body: (read: Read) => Promise<object>
): Promise<CallToolResult> {
  const startedAt = performance.now();
  let stale = false;
  let dataAgeMs: number | null = null;
  const read: Read = (work) =>
    runTarkovRead(work, {
      signal: context.signal,
      onStale: () => {
        stale = true;
      },
      onDataAge: (ageMs) => {
        dataAgeMs = Math.max(dataAgeMs ?? 0, ageMs);
      },
    });
  let outcome: ToolOutcome = "ok";
  try {
    const result = await body(read);
    const payload: Record<string, unknown> = stale ? { ...result, dataNotice: staleNotice(dataAgeMs) } : { ...result };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  } catch (error) {
    outcome = classifyError(error, context);
    if (outcome === "crash") console.error(`MCP ${call.tool} failed (request ${context.requestId})`, error);
    const message =
      outcome === "input_error"
        ? (error as Error).message
        : outcome === "crash"
          ? `${ERROR_MESSAGES.crash} Reference: ${context.requestId}.`
          : ERROR_MESSAGES[outcome];
    return { isError: true, content: [{ type: "text", text: message }] };
  } finally {
    console.info(
      JSON.stringify({
        event: "mcp_tool_call",
        requestId: context.requestId,
        tool: call.tool,
        gameMode: call.gameMode ?? null,
        outcome,
        durationMs: Math.round(performance.now() - startedAt),
        stale,
      })
    );
  }
}

function staleNotice(dataAgeMs: number | null) {
  const minutes = dataAgeMs === null ? null : Math.max(1, Math.round(dataAgeMs / 60_000));
  const age =
    minutes === null
      ? ""
      : ` from about ${minutes < 90 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${Math.round(minutes / 60)} hours`} ago`;
  return `tarkov.dev is unavailable, so this uses cached data${age}. Prices may have changed.`;
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

export function round(value: number | null | undefined, digits = 0): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export { InputError };
export type { GameMode };
