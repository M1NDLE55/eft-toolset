/** The value of one cookie on the request, or undefined. */
export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export interface CookieOptions {
  path?: string;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
}

/** Adds a Set-Cookie header (Path, Expires and Max-Age, then the flags), as the site has always set them. */
export function setCookie(headers: Headers, name: string, value: string, options: CookieOptions = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.maxAge !== undefined) {
    parts.push(`Expires=${new Date(Date.now() + options.maxAge * 1000).toUTCString()}`);
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.secure) parts.push("Secure");
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  headers.append("Set-Cookie", parts.join("; "));
}
