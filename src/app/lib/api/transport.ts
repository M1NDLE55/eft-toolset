import {
  CACHEABLE_OPERATIONS,
  MAX_GET_VARIABLES_LENGTH,
  canonicalJson,
  type TarkovOperation,
} from "./operations";

const API_URL = "/api/tarkov";
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_RETRIES = 1;
const MAX_API_RESPONSE_BYTES = 16 * 1024 * 1024;

export const STALE_UPSTREAM_EVENT = "eft-toolset:stale-upstream";
let upstreamStale = false;

export function isUpstreamStale() {
  return upstreamStale;
}

function setUpstreamStale(stale: boolean) {
  if (stale === upstreamStale || typeof window === "undefined") return;
  upstreamStale = stale;
  window.dispatchEvent(new Event(STALE_UPSTREAM_EVENT));
}

export class ApiTransportError extends Error {
  constructor(
    message: string,
    readonly kind: "http" | "api" | "network" | "decode" | "timeout",
    readonly status?: number,
    readonly code?: string,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "ApiTransportError";
  }
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
}

interface ApiResponse<T> {
  data?: T;
  error?: {
    message?: unknown;
    code?: unknown;
  };
}

export function apiRequestInit(
  operation: TarkovOperation,
  variables: Record<string, unknown>
): { url: string; init: RequestInit } {
  const encoded = canonicalJson(variables);
  if (CACHEABLE_OPERATIONS.has(operation) && encoded.length <= MAX_GET_VARIABLES_LENGTH) {
    const query = new URLSearchParams({ op: operation, v: encoded });
    return {
      url: `${API_URL}?${query.toString()}`,
      init: { method: "GET", headers: { Accept: "application/json" } },
    };
  }
  return {
    url: API_URL,
    init: {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ operation, variables }),
      cache: "no-store",
    },
  };
}

export async function apiFetch<T>(
  operation: TarkovOperation,
  variables: Record<string, unknown>,
  options: ApiRequestOptions = {}
): Promise<T> {
  const retries = clamp(options.retries, 0, 5, DEFAULT_RETRIES);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce<T>(operation, variables, options);
    } catch (error) {
      const normalized = normalizeError(error);
      if (options.signal?.aborted) throw options.signal.reason ?? normalized;
      if (attempt >= retries || !isRetryable(normalized)) throw normalized;
      await delay(retryDelay(attempt, normalized), options.signal);
    }
  }
}

async function requestOnce<T>(
  operation: TarkovOperation,
  variables: Record<string, unknown>,
  options: ApiRequestOptions
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = clamp(options.timeoutMs, 1, 60_000, DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => {
    controller.abort(new ApiTransportError("The API request timed out.", "timeout"));
  }, timeoutMs);

  const abortFromCaller = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const { url, init } = apiRequestInit(operation, variables);
    const response = await fetch(url, { ...init, signal: controller.signal });

    let json: ApiResponse<T>;
    try {
      json = (await readJsonWithLimit(response)) as ApiResponse<T>;
    } catch {
      throw new ApiTransportError(
        `The API returned an unreadable response (${response.status}).`,
        "decode",
        response.status
      );
    }

    if (!json || typeof json !== "object") {
      throw new ApiTransportError(
        `The API returned an invalid response (${response.status}).`,
        "decode",
        response.status
      );
    }

    const message = typeof json.error?.message === "string" ? json.error.message : undefined;
    const code = typeof json.error?.code === "string" ? json.error.code : undefined;

    if (!response.ok) {
      throw new ApiTransportError(
        message ?? `The API request failed (${response.status}).`,
        "http",
        response.status,
        code,
        parseRetryAfter(response.headers.get("retry-after"))
      );
    }

    if (json.error) {
      throw new ApiTransportError(message ?? "The API request failed.", "api", response.status, code);
    }

    if (json.data === undefined) {
      throw new ApiTransportError("The API response did not contain data.", "decode", response.status);
    }

    setUpstreamStale(response.headers.get("x-eft-data-stale") === "true");
    return json.data;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof ApiTransportError) {
      throw controller.signal.reason;
    }
    if (error instanceof ApiTransportError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiTransportError(
      error instanceof Error ? error.message : "The API request failed.",
      "network"
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function clamp(value: number | undefined, min: number, max: number, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeError(error: unknown): ApiTransportError {
  if (error instanceof ApiTransportError) return error;
  return new ApiTransportError(
    error instanceof Error ? error.message : "The API request failed.",
    "network"
  );
}

function isRetryable(error: ApiTransportError) {
  return (
    error.kind === "network" ||
    error.kind === "timeout" ||
    error.status === 408 ||
    error.status === 429 ||
    (typeof error.status === "number" && error.status >= 500 && error.status !== 501)
  );
}

function retryDelay(attempt: number, error: ApiTransportError) {
  if (error.retryAfterMs !== undefined) return Math.min(30_000, error.retryAfterMs);
  const exponential = Math.min(2_000, 250 * 2 ** attempt);
  return exponential * (0.75 + Math.random() * 0.5);
}

async function readJsonWithLimit(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_API_RESPONSE_BYTES) {
    throw new Error("The API response was too large.");
  }
  if (!response.body) throw new Error("The API returned an empty response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_API_RESPONSE_BYTES) {
        await reader.cancel("Response exceeded the configured limit.");
        throw new Error("The API response was too large.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join("")) as unknown;
  } finally {
    reader.releaseLock();
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
