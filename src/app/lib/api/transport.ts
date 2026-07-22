const API_URL = "https://api.tarkov.dev/graphql";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

export interface GraphQLIssue {
  message: string;
  path?: readonly (string | number)[];
  extensions?: Record<string, unknown>;
}

export class GraphQLTransportError extends Error {
  constructor(
    message: string,
    readonly kind: "http" | "graphql" | "network" | "decode" | "timeout",
    readonly status?: number,
    readonly issues: GraphQLIssue[] = [],
    readonly partialData?: unknown
  ) {
    super(message);
    this.name = "GraphQLTransportError";
  }
}

export interface GraphQLRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  operationName?: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: unknown[];
}

export async function gqlFetch<T>(
  query: string,
  variables: Record<string, unknown>,
  options: GraphQLRequestOptions = {}
): Promise<T> {
  const startedAt = now();
  const operationName = options.operationName ?? operationNameFrom(query);
  const requestedRetries = options.retries ?? DEFAULT_RETRIES;
  const retries = Number.isFinite(requestedRetries)
    ? Math.min(5, Math.max(0, Math.floor(requestedRetries)))
    : DEFAULT_RETRIES;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await requestOnce<T>(query, variables, options);
      reportQuery({ operationName, durationMs: now() - startedAt, status: "success", attempt });
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      if (options.signal?.aborted) throw options.signal.reason ?? normalized;

      if (attempt >= retries || !isRetryable(normalized)) {
        reportQuery({
          operationName,
          durationMs: now() - startedAt,
          status: "error",
          attempt,
          errorKind: normalized.kind,
          httpStatus: normalized.status,
        });
        throw normalized;
      }

      await delay(retryDelay(attempt), options.signal);
    }
  }
}

async function requestOnce<T>(
  query: string,
  variables: Record<string, unknown>,
  options: GraphQLRequestOptions
): Promise<T> {
  const controller = new AbortController();
  const requestedTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(60_000, Math.max(1, requestedTimeout))
    : DEFAULT_TIMEOUT_MS;
  const timeout = windowSafeSetTimeout(() => {
    controller.abort(new GraphQLTransportError("The API request timed out.", "timeout"));
  }, timeoutMs);

  const abortFromCaller = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      cache: "no-store",
    });

    let json: GraphQLResponse<T>;
    try {
      json = (await response.json()) as GraphQLResponse<T>;
    } catch {
      throw new GraphQLTransportError(
        `The API returned an unreadable response (${response.status}).`,
        "decode",
        response.status
      );
    }

    if (!json || typeof json !== "object") {
      throw new GraphQLTransportError(
        `The API returned an invalid response (${response.status}).`,
        "decode",
        response.status
      );
    }

    if (!response.ok) {
      const issues = normalizeIssues(json.errors);
      throw new GraphQLTransportError(
        issues[0]?.message ?? `The API request failed (${response.status}).`,
        "http",
        response.status,
        issues,
        json.data
      );
    }

    const issues = normalizeIssues(json.errors);
    if (issues.length > 0) {
      throw new GraphQLTransportError(
        issues.map((issue) => issue.message).join("; "),
        "graphql",
        response.status,
        issues,
        json.data
      );
    }

    if (json.data === undefined) {
      throw new GraphQLTransportError("The API response did not contain data.", "decode", response.status);
    }

    return json.data;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof GraphQLTransportError) {
      throw controller.signal.reason;
    }
    if (error instanceof GraphQLTransportError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new GraphQLTransportError(
      error instanceof Error ? error.message : "The API request failed.",
      "network"
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function normalizeIssues(errors: unknown): GraphQLIssue[] {
  if (errors === undefined) return [];
  if (!Array.isArray(errors)) return [{ message: "The API returned malformed GraphQL errors." }];
  return errors.map((issue) => {
    if (typeof issue === "string") return { message: issue };
    if (!issue || typeof issue !== "object") return { message: "Unknown GraphQL error" };
    const candidate = issue as Partial<GraphQLIssue>;
    return {
      message: typeof candidate.message === "string" ? candidate.message : "Unknown GraphQL error",
      ...(Array.isArray(candidate.path) ? { path: candidate.path } : {}),
      ...(candidate.extensions && typeof candidate.extensions === "object"
        ? { extensions: candidate.extensions }
        : {}),
    };
  });
}

function normalizeError(error: unknown): GraphQLTransportError {
  if (error instanceof GraphQLTransportError) return error;
  return new GraphQLTransportError(
    error instanceof Error ? error.message : "The API request failed.",
    "network"
  );
}

function isRetryable(error: GraphQLTransportError) {
  return (
    error.kind === "network" ||
    error.kind === "timeout" ||
    error.status === 408 ||
    error.status === 429 ||
    (typeof error.status === "number" && error.status >= 500)
  );
}

function retryDelay(attempt: number) {
  const exponential = Math.min(2_000, 250 * 2 ** attempt);
  return exponential * (0.75 + Math.random() * 0.5);
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

function operationNameFrom(query: string) {
  return /\b(?:query|mutation)\s+([A-Za-z0-9_]+)/.exec(query)?.[1] ?? "AnonymousOperation";
}

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function windowSafeSetTimeout(callback: () => void, timeoutMs: number) {
  return setTimeout(callback, timeoutMs);
}

interface QueryEventDetail {
  operationName: string;
  durationMs: number;
  status: "success" | "error";
  attempt: number;
  errorKind?: GraphQLTransportError["kind"];
  httpStatus?: number;
}

function reportQuery(detail: QueryEventDetail) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("eft-toolset:query", { detail }));
  }
}
