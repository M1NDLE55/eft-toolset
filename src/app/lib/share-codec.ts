// Generic share-link encoding shared by the gun builder and raid planner:
// JSON → gzip (when it helps) → base64url, with a prefix marking the variant.

const GZIP_PREFIX = "gz.";
const JSON_PREFIX = "j.";

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
  const compressed = await gzip(bytes);

  if (compressed && compressed.length < bytes.length) {
    return `${GZIP_PREFIX}${bytesToBase64Url(compressed)}`;
  }

  return `${JSON_PREFIX}${bytesToBase64Url(bytes)}`;
}

export async function decodeSharePayload(payload: string): Promise<unknown> {
  const trimmed = payload.trim();
  const bytes = trimmed.startsWith(GZIP_PREFIX)
    ? await gunzip(base64UrlToBytes(trimmed.slice(GZIP_PREFIX.length)))
    : trimmed.startsWith(JSON_PREFIX)
      ? base64UrlToBytes(trimmed.slice(JSON_PREFIX.length))
      : base64UrlToBytes(trimmed);

  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function gzip(bytes: Uint8Array) {
  if (typeof CompressionStream === "undefined") return null;

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot read compressed share links.");
  }

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
