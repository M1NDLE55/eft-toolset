import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/tarkov/route";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";

beforeEach(() => {
  resetRequestBudgets();
  vi.stubEnv("CLIENT_IP_HEADER", "cf-connecting-ip");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Tarkov query route", () => {
  it("rejects operations outside the allowlist", async () => {
    const response = await POST(
      new Request("http://localhost/api/tarkov", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "arbitrary.query", variables: {} }),
      })
    );
    await expect(response.json()).resolves.toEqual({
      error: { message: "Unknown query operation.", code: "INVALID_OPERATION" },
    });
    expect(response.status).toBe(400);
  });

  it("only accepts canonical GET requests for cacheable operations", async () => {
    const get = (query: string) =>
      GET(new Request(`http://localhost/api/tarkov?${query}`, { headers: { "CF-Connecting-IP": "198.51.100.7" } }));
    const v = encodeURIComponent('{"gameMode":"regular","name":"x"}');

    expect((await get(`op=item.group&v=${encodeURIComponent('{"gameMode":"regular","names":[]}')}`)).status).toBe(400);
    expect((await get(`op=item.detail&v=${encodeURIComponent('{"name":"x","gameMode":"regular"}')}`)).status).toBe(400);
    expect((await get(`op=item.detail&v=${v}&extra=1`)).status).toBe(400);
    expect((await get(`op=item.detail&op=item.detail&v=${v}`)).status).toBe(400);
    expect((await get(`op=item.detail&v=${encodeURIComponent("x".repeat(2_000))}`)).status).toBe(414);
    const invalid = await get(`op=item.detail&v=${encodeURIComponent('{"gameMode":"nope","name":"x"}')}`);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("no-store");
  });

  it("enforces the body limit even without a content-length header", async () => {
    const response = await POST(
      new Request("http://localhost/api/tarkov", {
        method: "POST",
        body: JSON.stringify({ value: "x".repeat(70_000) }),
      })
    );
    expect(response.status).toBe(413);
  });

  it("rate-limits repeated requests from the same client", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
    const responses = [];
    for (let index = 0; index < 121; index += 1) {
      responses.push(
        await POST(
          new Request("http://localhost/api/tarkov", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "CF-Connecting-IP": "203.0.113.44",
            },
            body: JSON.stringify({ operation: "arbitrary.query", variables: {} }),
          })
        )
      );
    }

    expect(responses[119].status).toBe(400);
    expect(responses[120].status).toBe(429);
    expect(responses[120].headers.get("retry-after")).toBe("1");
  });
});

describe("slow uploads", () => {
  it("do not hold shared operation slots while their bodies are still arriving", async () => {
    const { tryAcquireOperationSlot, releaseOperationSlot } = await import("@/app/lib/api/tarkov-server");
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    const pending = Array.from({ length: 20 }, (_, index) =>
      POST(
        new Request("http://localhost/api/tarkov", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": `192.0.2.${index}` },
          body: new ReadableStream<Uint8Array>({ start: (controller) => void streams.push(controller) }),
          duplex: "half",
        } as RequestInit)
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const acquired = Array.from({ length: 16 }, () => tryAcquireOperationSlot());
    acquired.forEach((ok) => ok && releaseOperationSlot());
    for (const controller of streams) controller.close();
    await Promise.all(pending);
    expect(acquired.every(Boolean)).toBe(true);
  });
});

describe("client identity on Vercel", () => {
  it("ignores spoofed forwarding headers and uses Vercel's client IP", async () => {
    vi.stubEnv("CLIENT_IP_HEADER", "");
    vi.stubEnv("VERCEL", "1");
    vi.spyOn(Date, "now").mockReturnValue(1_950_000_000_000);
    try {
      const responses = [];
      for (let index = 0; index < 121; index += 1) {
        responses.push(
          await POST(
            new Request("http://localhost/api/tarkov", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Real-IP": "198.51.100.99",
                "CF-Connecting-IP": `203.0.113.${index % 250}`,
              },
              body: JSON.stringify({ operation: "arbitrary.query", variables: {} }),
            })
          )
        );
      }
      expect(responses[120].status).toBe(429);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("client identity without a trusted header", () => {
  it("applies only the global limit instead of trusting forgeable forwarding headers", async () => {
    vi.stubEnv("CLIENT_IP_HEADER", "");
    vi.spyOn(Date, "now").mockReturnValue(1_960_000_000_000);
    const responses = [];
    // More than one client's 120 requests, up to the global 300.
    for (let index = 0; index < 301; index += 1) {
      responses.push(
        await POST(
          new Request("http://localhost/api/tarkov", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "CF-Connecting-IP": "203.0.113.7",
              "X-Forwarded-For": `198.51.100.${index % 250}`,
            },
            body: JSON.stringify({ operation: "arbitrary.query", variables: {} }),
          })
        )
      );
    }
    expect(responses[299].status).toBe(400);
    expect(responses[300].status).toBe(429);
  });
});

describe("public cache policy", () => {
  it("never lets shared caches outlive the server's stale ceiling", async () => {
    const { publicCacheControl } = await import("@/app/lib/api/cache-control");
    expect(publicCacheControl(false, 0)).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=21300");
    expect(publicCacheControl(false, 5 * 60 * 60_000)).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=3300");
    expect(publicCacheControl(false, 6 * 60 * 60_000 - 200_000)).toBe("no-store");
    expect(publicCacheControl(true, 60_000)).toBe("public, max-age=0, s-maxage=30");
    expect(publicCacheControl(true, 6 * 60 * 60_000)).toBe("no-store");
  });
});
