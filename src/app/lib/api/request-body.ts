import type { BudgetPool } from "./rate-limit";

const BODY_READ_TIMEOUT_MS = 5_000;
// Each pool has its own cap, so slow MCP uploads can't make the website's POSTs wait.
const MAX_CONCURRENT_BODY_READS: Record<BudgetPool, number> = { web: 32, mcp: 16 };

const activeBodyReads: Record<BudgetPool, number> = { web: 0, mcp: 0 };

export class RequestBodyTooLargeError extends Error {}
export class RequestBodyBusyError extends Error {}

export async function readBodyWithLimit(request: Request, maxBytes: number, pool: BudgetPool = "web"): Promise<string> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }
  if (activeBodyReads[pool] >= MAX_CONCURRENT_BODY_READS[pool]) throw new RequestBodyBusyError();
  activeBodyReads[pool] += 1;
  try {
    return await readBody(request, maxBytes);
  } finally {
    activeBodyReads[pool] -= 1;
  }
}

async function readBody(request: Request, maxBytes: number): Promise<string> {
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
      if (bytesRead > maxBytes) {
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
