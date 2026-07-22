import { NextResponse } from "next/server";
import { isTarkovOperation } from "@/app/lib/api/operations";
import {
  executeTarkovOperation,
  TarkovRequestError,
  TarkovUpstreamError,
} from "@/app/lib/api/tarkov-server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("Request body is too large.", "INVALID_REQUEST", 413);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse("Request body could not be read.", "INVALID_REQUEST", 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return errorResponse("Request body is too large.", "INVALID_REQUEST", 413);
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

  try {
    const data = await executeTarkovOperation(operation, variables);
    return NextResponse.json(
      { data },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
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
        502
      );
    }
    console.error("Tarkov query failed", error);
    return errorResponse("The query could not be completed.", "INTERNAL_ERROR", 500);
  }
}

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json(
    { error: { message, code } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}
