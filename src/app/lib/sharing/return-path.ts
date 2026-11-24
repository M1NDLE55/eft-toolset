/**
 * Where a plain "Sign in" link may send the visitor back to (§15). Never a URL from the client:
 * only a path on this site, under an allowlisted prefix. Anything else falls back to the account
 * section of Settings. Only the path and query are kept; the fragment is dropped.
 */
export const RETURN_PATH_PREFIXES = ["/settings", "/data", "/gun-builder", "/item-groups", "/raid-planner", "/s/", "/quests", "/item"] as const;
export const DEFAULT_RETURN_PATH = "/settings#account";
const MAX_RETURN_PATH_LENGTH = 512;
const PLACEHOLDER_ORIGIN = "https://return-path.invalid";

export function safeReturnPath(path: string | null | undefined): string {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_RETURN_PATH_LENGTH) return DEFAULT_RETURN_PATH;
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return DEFAULT_RETURN_PATH;
  // Control characters (including tab and newline, which URL parsing would strip) and backslashes.
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return DEFAULT_RETURN_PATH;
  let url: URL;
  try {
    url = new URL(path, PLACEHOLDER_ORIGIN);
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return DEFAULT_RETURN_PATH;
  const allowed = RETURN_PATH_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? url.pathname.startsWith(prefix) : url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
  );
  return allowed ? `${url.pathname}${url.search}` : DEFAULT_RETURN_PATH;
}
