const BASE64_MARKER = "~b.";

/** The versioned base64url form survives the router's own URI decoding. */
export function customEncodeURI(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${BASE64_MARKER}${btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;
}

export function customDecodeURI(value: string) {
  if (typeof value !== "string" || value.length > 2_048) return "";
  if (value.startsWith(BASE64_MARKER)) {
    const encoded = value.slice(BASE64_MARKER.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return "";
    try {
      const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(
        normalized.padEnd(
          normalized.length + ((4 - (normalized.length % 4)) % 4),
          "="
        )
      );
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return decoded.length <= 500 ? decoded : "";
    } catch {
      return "";
    }
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Next already decodes dynamic route segments. Preserve a valid old
    // marker containing a literal percent even when a second decode fails.
    return value.startsWith("~") && value.length <= 501 ? value.slice(1) : "";
  }
  if (decoded.length > 500) return "";

  if (decoded.startsWith("~")) return decoded.slice(1);

  // Compatibility with links created before the lossless format.
  return decoded.replace(/-/g, " ").replace(/_/g, "-");
}
