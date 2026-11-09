const BODY_READ_TIMEOUT_MS = 5_000;
const MAX_CONCURRENT_BODY_READS = 32;

let activeBodyReads = 0;

export class RequestBodyTooLargeError extends Error {}
export class RequestBodyBusyError extends Error {}

export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<string> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }
  if (activeBodyReads >= MAX_CONCURRENT_BODY_READS) throw new RequestBodyBusyError();
  activeBodyReads += 1;
  try {
    return await readBody(request, maxBytes);
  } finally {
    activeBodyReads -= 1;
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
