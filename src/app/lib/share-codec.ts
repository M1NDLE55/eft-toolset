// Generic share-link encoding shared by the gun builder and raid planner:
// JSON → gzip (when it helps) → base64url, with a prefix marking the variant.

const GZIP_PREFIX = "gz.";
const JSON_PREFIX = "j.";
const MAX_ENCODED_LENGTH = 400_000;
const MAX_DECODED_BYTES = 2_000_000;

export function slugifyName(name: string, fallback: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || fallback;
}

export async function encodeSharePayload(recipe: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(recipe));
  if (bytes.length > MAX_DECODED_BYTES) {
    throw new Error("This share payload is too large.");
  }
  const compressed = await gzip(bytes);

  if (compressed && compressed.length < bytes.length) {
    const encoded = `${GZIP_PREFIX}${bytesToBase64Url(compressed)}`;
    if (encoded.length > MAX_ENCODED_LENGTH) throw new Error("This share payload is too large.");
    return encoded;
  }

  const encoded = `${JSON_PREFIX}${bytesToBase64Url(bytes)}`;
  if (encoded.length > MAX_ENCODED_LENGTH) throw new Error("This share payload is too large.");
  return encoded;
}

export async function decodeSharePayload(payload: string): Promise<unknown> {
  const trimmed = payload.trim();
  if (!trimmed || trimmed.length > MAX_ENCODED_LENGTH) {
    throw new Error("Shared payload size is invalid.");
  }
  const bytes = trimmed.startsWith(GZIP_PREFIX)
    ? await gunzip(base64UrlToBytes(trimmed.slice(GZIP_PREFIX.length)))
    : trimmed.startsWith(JSON_PREFIX)
      ? base64UrlToBytes(trimmed.slice(JSON_PREFIX.length))
      : base64UrlToBytes(trimmed);

  if (bytes.length > MAX_DECODED_BYTES) throw new Error("Shared payload is too large.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

async function gzip(bytes: Uint8Array) {
  if (typeof CompressionStream === "undefined") return null;

  const blob = new Blob([bytes]);
  if (typeof blob.stream !== "function") return null;
  const stream = blob.stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot read compressed share links.");
  }

  const blob = new Blob([bytes]);
  if (typeof blob.stream !== "function") {
    throw new Error("This browser cannot read compressed share links.");
  }
  const stream = blob.stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DECODED_BYTES) {
      await reader.cancel("Shared payload is too large.");
      throw new Error("Shared payload is too large.");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!value || value.length > MAX_ENCODED_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Shared payload encoding is invalid.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
