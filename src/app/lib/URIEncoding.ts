/**
 * The marker distinguishes lossless new routes from the original lossy
 * space/hyphen transform, so existing bookmarks remain readable.
 */
export function customEncodeURI(value: string) {
  return `~${encodeURIComponent(value)}`;
}

export function customDecodeURI(value: string) {
  const decoded = decodeURIComponent(value);

  if (decoded.startsWith("~")) return decoded.slice(1);

  // Compatibility with links created before the lossless format.
  return decoded.replace(/-/g, " ").replace(/_/g, "-");
}
