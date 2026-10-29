import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/proxy";

describe("content security policy", () => {
  const policy = buildContentSecurityPolicy("test-nonce", "production");

  it("keeps nonce-based scripts and allows the Cloudflare beacon to report", () => {
    expect(policy).toContain("script-src 'self' https://static.cloudflareinsights.com 'nonce-test-nonce' 'strict-dynamic'");
    expect(policy).toContain("connect-src 'self' https://assets.tarkov.dev https://cloudflareinsights.com");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("va.vercel-scripts.com");
  });

  it("allows the development compiler only outside production", () => {
    expect(buildContentSecurityPolicy("test-nonce", "development")).toContain("'unsafe-eval'");
  });
});
