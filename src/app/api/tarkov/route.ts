import { NextResponse } from "next/server";
import {
  CACHEABLE_OPERATIONS,
  MAX_GET_VARIABLES_LENGTH,
  canonicalJson,
  isTarkovOperation,
  type TarkovOperation,
} from "@/app/lib/api/operations";
import { publicCacheControl } from "@/app/lib/api/cache-control";
import {
  executeTarkovOperation,
  TarkovRequestError,
  TarkovUpstreamError,
} from "@/app/lib/api/tarkov-server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_CONCURRENT_REQUESTS = 16;
const CLIENT_BURST = 120;
const CLIENT_REFILL_PER_SECOND = 2;
const GLOBAL_BURST = 300;
const GLOBAL_REFILL_PER_SECOND = 5;
const MAX_RATE_LIMIT_ENTRIES = 10_000;
const MAX_URL_LENGTH = 2_048;
const BODY_READ_TIMEOUT_MS = 5_000;

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

const clientBuckets = new Map<string, TokenBucket>();
const globalBucket: TokenBucket = { tokens: GLOBAL_BURST, updatedAt: Date.now() };
let activeRequests = 0;

export async function GET(request: Request) {
  const rateLimited = rateLimitResponse(request);
  if (rateLimited) return rateLimited;

  if (request.url.length > MAX_URL_LENGTH) {
    return errorResponse("Request URL is too long.", "INVALID_REQUEST", 414);
  }
  const url = new URL(request.url);
  const keys = Array.from(url.searchParams.keys());
  const operation = url.searchParams.get("op");
  const encoded = url.searchParams.get("v");
  if (
    keys.length !== 2 ||
    operation === null ||
    encoded === null ||
    url.searchParams.getAll("op").length !== 1 ||
    url.searchParams.getAll("v").length !== 1
  ) {
    return errorResponse("Expected exactly the op and v query parameters.", "INVALID_REQUEST", 400);
  }
  if (!isTarkovOperation(operation) || !CACHEABLE_OPERATIONS.has(operation)) {
    return errorResponse("Unknown query operation.", "INVALID_OPERATION", 400);
  }
  if (encoded.length > MAX_GET_VARIABLES_LENGTH) {
    return errorResponse("Query variables are too large.", "INVALID_REQUEST", 414);
  }

  let variables: unknown;
  try {
    variables = JSON.parse(encoded) as unknown;
  } catch {
    return errorResponse("Query variables must be valid JSON.", "INVALID_REQUEST", 400);
  }
  if (canonicalJson(variables) !== encoded) {
    return errorResponse("Query variables must be canonical JSON.", "INVALID_REQUEST", 400);
  }

  return withSlot(() => execute(request, operation, variables, true));
}

export async function POST(request: Request) {
  const rateLimited = rateLimitResponse(request);
  if (rateLimited) return rateLimited;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("Request body is too large.", "INVALID_REQUEST", 413);
  }

  return withSlot(() => handlePost(request));
}

async function handlePost(request: Request) {
  let rawBody: string;
  try {
    rawBody = await readBodyWithLimit(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse("Request body is too large.", "INVALID_REQUEST", 413);
    }
    return errorResponse("Request body could not be read.", "INVALID_REQUEST", 400);
  }

  const contentType = request.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    return errorResponse("Request body must be JSON.", "INVALID_REQUEST", 415);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return errorResponse("Request body must be valid JSON.", "INVALID_REQUEST", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Request body must be an object.", "INVALID_REQUEST", 400);
  }
  const { operation, variables } = body as Record<string, unknown>;
  if (!isTarkovOperation(operation)) {
    return errorResponse("Unknown query operation.", "INVALID_OPERATION", 400);
  }

  return execute(request, operation, variables, false);
}

async function withSlot(handler: () => Promise<Response>) {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    return errorResponse("The service is busy. Try again shortly.", "RATE_LIMITED", 429, {
      "Retry-After": "1",
    });
  }
  activeRequests += 1;
  try {
    return await handler();
  } finally {
    activeRequests -= 1;
  }
}

async function execute(
  request: Request,
  operation: TarkovOperation,
  variables: unknown,
  cacheable: boolean
) {
  try {
    let stale = false;
    let dataAgeMs = 0;
    request.signal.throwIfAborted();
    const data = await executeTarkovOperation(operation, variables, {
      signal: request.signal,
      onStale: () => {
        stale = true;
      },
      onDataAge: (ageMs) => {
        dataAgeMs = ageMs;
      },
    });
    request.signal.throwIfAborted();
    return NextResponse.json(
      { data },
      {
        headers: {
          "Cache-Control": cacheable ? publicCacheControl(stale, dataAgeMs) : "private, no-store",
          "X-Content-Type-Options": "nosniff",
          ...(stale ? { "X-EFT-Data-Stale": "true" } : {}),
        },
      }
    );
  } catch (error) {
    if (error instanceof TarkovRequestError) {
      return errorResponse(error.message, error.code, 400);
    }
    if (error instanceof TarkovUpstreamError) {
      return errorResponse(
        "Tarkov.dev data is temporarily unavailable.",
        "UPSTREAM_UNAVAILABLE",
        502,
        { "Retry-After": "3" }
      );
    }
    if (request.signal.aborted) {
      return errorResponse("The request was cancelled.", "CANCELLED", 499);
    }
    console.error("Tarkov query failed", error);
    return errorResponse("The query could not be completed.", "INTERNAL_ERROR", 500);
  }
}

function rateLimitResponse(request: Request) {
  const rateLimit = consumeRequestBudget(request);
  if (rateLimit.allowed) return null;
  return errorResponse("Too many requests.", "RATE_LIMITED", 429, {
    "Retry-After": String(rateLimit.retryAfterSeconds),
  });
}

function errorResponse(
  message: string,
  code: string,
  status: number,
  extraHeaders: Record<string, string> = {}
) {
  return NextResponse.json(
    { error: { message, code } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...extraHeaders,
      },
    }
  );
}

class RequestBodyTooLargeError extends Error {}

async function readBodyWithLimit(request: Request): Promise<string> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let result = "";
  let bytesRead = 0;
  const deadline = setTimeout(() => {
    void reader.cancel("Request body read timed out.").catch(() => undefined);
  }, BODY_READ_TIMEOUT_MS);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_REQUEST_BYTES) {
        await reader.cancel("Request body is too large.");
        throw new RequestBodyTooLargeError();
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
}

function consumeRequestBudget(request: Request): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const key = clientKey(request);
  const bucket = clientBuckets.get(key) ?? { tokens: CLIENT_BURST, updatedAt: now };
  const clientResult = consumeToken(bucket, CLIENT_BURST, CLIENT_REFILL_PER_SECOND, now);
  clientBuckets.delete(key);
  clientBuckets.set(key, bucket);
  while (clientBuckets.size > MAX_RATE_LIMIT_ENTRIES) {
    const oldestKey = clientBuckets.keys().next().value;
    if (oldestKey === undefined) break;
    clientBuckets.delete(oldestKey);
  }

  if (!clientResult.allowed) return clientResult;

  return consumeToken(globalBucket, GLOBAL_BURST, GLOBAL_REFILL_PER_SECOND, now);
}

function consumeToken(
  bucket: TokenBucket,
  capacity: number,
  refillPerSecond: number,
  now: number
) {
  const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSecond)),
  };
}

function clientKey(request: Request) {
  const trustedHeader = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (trustedHeader) {
    return (request.headers.get(trustedHeader)?.split(",")[0]?.trim() || "unknown").slice(0, 128);
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwarded ||
    "unknown"
  ).slice(0, 128);
}
