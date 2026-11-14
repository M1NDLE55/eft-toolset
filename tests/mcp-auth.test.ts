// @vitest-environment node
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { POST, OPTIONS } from "@/app/api/mcp/route";
import { GET as metadataGet } from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { memoryRateLimitStore, sharedRateLimitStore, upstashRateLimitStore } from "@/app/lib/api/rate-limit-store";
import { mcpAuthConfig, verifyAccessToken } from "@/app/lib/mcp/auth";

const ISSUER = "https://eft-test.authkit.app";
const RESOURCE = "https://www.eft-toolset.com/api/mcp";
const METADATA_URL = "https://www.eft-toolset.com/.well-known/oauth-protected-resource/api/mcp";

let signingKey: CryptoKey;
let publicJwk: JWK;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  otherKey = (await generateKeyPair("RS256")).privateKey;
});

function token(
  claims: Record<string, unknown> = {},
  { key = signingKey, issuer = ISSUER, audience = RESOURCE, expiresIn = "5m" as string | number } = {}
) {
  return new SignJWT({ sub: "user_01", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

let requestId = 0;

function mcp(method: string, headers: Record<string, string> = {}, params?: unknown) {
  requestId += 1;
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "CF-Connecting-IP": "192.0.2.10",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, ...(params ? { params } : {}) }),
    })
  );
}

const bearer = async (claims: Record<string, unknown> = {}, ip = "192.0.2.10") => ({
  Authorization: `Bearer ${await token(claims)}`,
  "CF-Connecting-IP": ip,
});
const lookupTerm = { name: "lookup_term", arguments: { terms: ["Big Red"] } };

function enableAuth() {
  vi.stubEnv("MCP_AUTHKIT_DOMAIN", "eft-test.authkit.app");
  vi.stubEnv("MCP_RESOURCE_URL", RESOURCE);
}

beforeEach(() => {
  resetRequestBudgets();
  vi.stubEnv("CLIENT_IP_HEADER", "cf-connecting-ip");
  vi.stubEnv("MCP_AUTHKIT_DOMAIN", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KV_REST_API_TOKEN", "");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input) === `${ISSUER}/oauth2/jwks`) return Response.json({ keys: [publicJwk] });
    return new Response("unexpected fetch", { status: 500 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("access token validation", () => {
  beforeEach(enableAuth);

  it("accepts a token AuthKit signed for this server and names its user", async () => {
    expect(await verifyAccessToken(await token(), mcpAuthConfig()!)).toEqual({ kind: "user", subject: "user_01" });
  });

  it("rejects expired tokens, tokens for another resource or issuer, foreign keys, and agent tokens", async () => {
    const config = mcpAuthConfig()!;
    const rejected = [
      await token({}, { expiresIn: Math.floor(Date.now() / 1000) - 120 }),
      await token({}, { audience: "https://other.example/api/mcp" }),
      await token({}, { audience: "client_01ENVIRONMENT" }),
      await token({}, { issuer: "https://evil.authkit.app" }),
      await token({}, { key: otherKey }),
      await token({ sub_profile: "ai_agent" }),
      "not-a-jwt",
    ];
    for (const value of rejected) expect(await verifyAccessToken(value, config)).toEqual({ kind: "invalid" });
  });

  it("tells an unreachable key set apart from a bad token", async () => {
    vi.stubEnv("MCP_AUTHKIT_DOMAIN", "https://unreachable.authkit.app");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const config = mcpAuthConfig()!;
    const signed = await token({}, { issuer: config.issuer });
    expect(await verifyAccessToken(signed, config)).toEqual({ kind: "unverifiable" });
    const response = await mcp("tools/list", { Authorization: `Bearer ${signed}` });
    expect(response.status).toBe(503);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("derives the issuer, key set, and metadata URL from the environment", () => {
    expect(mcpAuthConfig()).toEqual({
      issuer: ISSUER,
      jwksUrl: new URL(`${ISSUER}/oauth2/jwks`),
      resource: RESOURCE,
      resourceMetadataUrl: METADATA_URL,
    });
  });
});

describe("MCP endpoint with sign-in on", () => {
  beforeEach(enableAuth);

  it("serves anonymous callers and offers sign-in on every tool", async () => {
    const response = await mcp("tools/list");
    expect(response.status).toBe(200);
    const { result } = await response.json();
    const schemes = [{ type: "noauth" }, { type: "oauth2", scopes: [] }];
    expect(result.tools.length).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.securitySchemes).toEqual(schemes);
      expect(tool._meta.securitySchemes).toEqual(schemes);
    }
  });

  it("asks an anonymous caller over its budget to sign in, with a header and a ChatGPT tool challenge", async () => {
    vi.stubEnv("MCP_ANON_RATE_BURST", "1");
    vi.stubEnv("MCP_ANON_RATE_PER_SECOND", "0.001");
    expect((await mcp("tools/call", {}, lookupTerm)).status).toBe(200);

    const listed = await mcp("tools/list");
    expect(listed.status).toBe(401);
    expect(listed.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${METADATA_URL}"`);
    expect(listed.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
    expect((await listed.json()).error.message).toMatch(/sign in/i);

    const called = await mcp("tools/call", {}, lookupTerm);
    expect(called.status).toBe(200);
    const body = await called.json();
    expect(body.id).toBe(requestId);
    expect(body.result.isError).toBe(true);
    expect(body.result._meta["mcp/www_authenticate"]).toEqual([
      expect.stringMatching(
        new RegExp(`^Bearer resource_metadata="${METADATA_URL}", error="insufficient_scope", error_description="[^"]+"$`)
      ),
    ]);

    expect((await mcp("tools/call", await bearer(), lookupTerm)).status).toBe(200);
  });

  it("answers bad tokens with invalid_token challenges, never as anonymous, even when the IP is out of budget", async () => {
    vi.stubEnv("MCP_ANON_RATE_BURST", "0.25");
    vi.stubEnv("MCP_ANON_RATE_PER_SECOND", "0.001");
    expect((await mcp("ping")).status).toBe(200);
    expect((await mcp("ping")).status).toBe(401);
    const expired = await token({}, { expiresIn: Math.floor(Date.now() / 1000) - 120 });
    for (const authorization of [`Bearer ${expired}`, "Bearer garbage", "Bearer"]) {
      const listed = await mcp("tools/list", { Authorization: authorization });
      expect(listed.status).toBe(401);
      expect(listed.headers.get("www-authenticate")).toMatch(
        new RegExp(`^Bearer resource_metadata="${METADATA_URL}", error="invalid_token", error_description="[^"]+"$`)
      );
      const called = await mcp("tools/call", { Authorization: authorization }, lookupTerm);
      expect(called.status).toBe(401);
      expect(called.headers.get("www-authenticate")).toBe(listed.headers.get("www-authenticate"));
    }
    expect((await mcp("tools/list", { Authorization: "Basic dXNlcjpwYXNz", "CF-Connecting-IP": "192.0.2.20" })).status).toBe(200);
  });

  it("keys signed-in budgets on the token's subject, apart from IPs and other users", async () => {
    vi.stubEnv("MCP_USER_RATE_BURST", "1");
    vi.stubEnv("MCP_USER_RATE_PER_SECOND", "0.001");
    vi.stubEnv("MCP_ANON_RATE_BURST", "1");
    vi.stubEnv("MCP_ANON_RATE_PER_SECOND", "0.001");
    expect((await mcp("tools/call", await bearer({}, "198.51.100.1"), lookupTerm)).status).toBe(200);
    const limited = await mcp("tools/call", await bearer({}, "198.51.100.2"), lookupTerm);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("www-authenticate")).toBeNull();
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await mcp("tools/call", await bearer({ sub: "user_02" }, "198.51.100.1"), lookupTerm)).status).toBe(200);
    expect((await mcp("tools/call", { "CF-Connecting-IP": "198.51.100.1" }, lookupTerm)).status).toBe(200);
  });

  it("delivers the tool challenge to an SDK client as a tool result", async () => {
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      fetch: (async (url: string | URL, init?: RequestInit) => POST(new Request(url, init))) as typeof fetch,
    });
    const client = new Client({ name: "t", version: "1" });
    await client.connect(transport);
    vi.stubEnv("MCP_ANON_RATE_BURST", "0.5");
    vi.stubEnv("MCP_ANON_RATE_PER_SECOND", "0.001");
    const result = await client.callTool(lookupTerm);
    expect(result.isError).toBe(true);
    expect(result._meta?.["mcp/www_authenticate"]).toEqual([expect.stringContaining('error="insufficient_scope"')]);
    await client.close();
  });

  it("serves protected resource metadata at both well-known paths", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
      const response = metadataGet(new Request(`https://www.eft-toolset.com${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        bearer_methods_supported: ["header"],
        resource_name: "EFT Toolset",
        resource_documentation: "https://www.eft-toolset.com/mcp",
      });
    }
    expect(metadataGet(new Request("https://www.eft-toolset.com/.well-known/oauth-protected-resource/other")).status).toBe(404);
  });

  it("lets browser clients send tokens", async () => {
    const response = OPTIONS(new Request("http://localhost/api/mcp", { method: "OPTIONS", headers: { Origin: "http://localhost:6274" } }));
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
  });
});

describe("MCP endpoint with sign-in off", () => {
  it("behaves as before: no schemes, no metadata, tokens ignored, and 429 when over budget", async () => {
    expect(mcpAuthConfig()).toBeNull();
    const listed = await mcp("tools/list", { Authorization: "Bearer garbage" });
    expect(listed.status).toBe(200);
    const { result } = await listed.json();
    for (const tool of result.tools) {
      expect(tool).not.toHaveProperty("securitySchemes");
      expect(tool._meta).toBeUndefined();
    }
    expect(metadataGet(new Request("https://www.eft-toolset.com/.well-known/oauth-protected-resource")).status).toBe(404);
    expect(
      OPTIONS(new Request("http://localhost/api/mcp", { method: "OPTIONS" })).headers.get("access-control-allow-headers")
    ).toBe("Content-Type, Accept, Mcp-Protocol-Version");

    vi.stubEnv("MCP_ANON_RATE_BURST", "1");
    vi.stubEnv("MCP_ANON_RATE_PER_SECOND", "0.001");
    expect((await mcp("tools/call", {}, lookupTerm)).status).toBe(200);
    const limited = await mcp("tools/list");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("www-authenticate")).toBeNull();
    expect(sharedRateLimitStore()).toBe(memoryRateLimitStore);
  });
});

describe("rate limit stores", () => {
  const limit = { burst: 10, refillPerSecond: 1 };

  it("uses Upstash when its REST settings are set, including the names Vercel sets", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "secret");
    expect(sharedRateLimitStore().kind).toBe("upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "secret");
    expect(sharedRateLimitStore().kind).toBe("upstash");
  });

  it("runs one atomic script per charge, under a key that doesn't reveal the client", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(Response.json({ result: [1, "9.75"] }));
    fetchMock.mockResolvedValueOnce(Response.json({ result: [0, "0.5"] }));
    const store = upstashRateLimitStore("https://example.upstash.io", "secret");
    expect(await store.consume("mcp:ip:203.0.113.7", limit, 0.25)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(await store.consume("mcp:ip:203.0.113.7", limit, 3, 0.25)).toEqual({ allowed: false, retryAfterSeconds: 3 });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://example.upstash.io");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
    const command = JSON.parse(String(init?.body)) as string[];
    expect(command[0]).toBe("EVAL");
    expect(command.slice(2, 3)).toEqual(["1"]);
    expect(command[3]).toMatch(/^eft:rl:[\w-]{43}$/);
    expect(command.join(" ")).not.toContain("203.0.113.7");
    expect(command.slice(4)).toEqual(["10", "1", expect.stringMatching(/^\d+$/), "3", "0.25"]);
  });

  it("counts in memory when Upstash fails, so requests are still served", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({ error: "WRONGPASS" }, { status: 401 }));
    const store = upstashRateLimitStore("https://example.upstash.io", "wrong");
    for (let i = 0; i < 10; i += 1) expect((await store.consume("key", limit, 1)).allowed).toBe(true);
    expect((await store.consume("key", limit, 1)).allowed).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("gives back what a request paid earlier when it is turned away", async () => {
    const tight = { burst: 1, refillPerSecond: 0.001 };
    expect((await memoryRateLimitStore.consume("refund", tight, 0.25)).allowed).toBe(true);
    expect(await memoryRateLimitStore.consume("refund", tight, 3, 0.25)).toEqual({ allowed: false, retryAfterSeconds: 2250 });
    expect((await memoryRateLimitStore.consume("refund", tight, 1)).allowed).toBe(true);
  });
});
