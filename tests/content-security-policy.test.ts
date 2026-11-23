import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, HSTS_HOST_PATTERN, securityHeaders } from "@/app/lib/security/headers";

describe("content security policy", () => {
  const policy = buildContentSecurityPolicy("production");
  const directives = new Map(policy.split("; ").map((entry) => [entry.split(" ")[0], entry]));

  it("allows scripts from this site, its inline scripts and the Cloudflare beacon, but not inline handlers", () => {
    // Cached pages can't carry a per-request nonce, and Next's inline RSC scripts can't be hashed.
    expect(directives.get("script-src")).toBe("script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com");
    expect(directives.get("script-src-attr")).toBe("script-src-attr 'none'");
    expect(directives.get("connect-src")).toBe("connect-src 'self' https://assets.tarkov.dev https://cloudflareinsights.com");
    expect(policy).not.toContain("nonce");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("va.vercel-scripts.com");
  });

  it("keeps framing, plugins, base URLs and form targets locked down", () => {
    expect(directives.get("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directives.get("object-src")).toBe("object-src 'none'");
    expect(directives.get("base-uri")).toBe("base-uri 'self'");
    expect(directives.get("form-action")).toBe("form-action 'self'");
  });

  it("loads EFT Wiki images in the browser without letting scripts or fetches reach the wiki CDN", () => {
    expect(directives.get("img-src")).toBe("img-src 'self' data: blob: https://assets.tarkov.dev https://static.wikia.nocookie.net");
    const others = Array.from(directives.values()).filter((entry) => !entry.startsWith("img-src "));
    expect(others.some((entry) => entry.includes("wikia"))).toBe(false);
  });

  it("allows the development compiler only outside production", () => {
    expect(buildContentSecurityPolicy("development")).toContain("'unsafe-eval'");
  });

  it("sends the policy with the other security headers", () => {
    const headers = new Map(securityHeaders("production").map(({ key, value }) => [key, value]));
    expect(headers.get("Content-Security-Policy")).toBe(policy);
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("sends HSTS on the production domain only", () => {
    const host = new RegExp(`^${HSTS_HOST_PATTERN}$`);
    expect(host.test("eft-toolset.com")).toBe(true);
    expect(host.test("www.eft-toolset.com")).toBe(true);
    expect(host.test("tarkov-git-branch.vercel.app")).toBe(false);
    expect(host.test("eft-toolset.com.evil.example")).toBe(false);
  });
});
