import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/tarkov/route";

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
    for (let index = 0; index < 61; index += 1) {
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

    expect(responses[59].status).toBe(400);
    expect(responses[60].status).toBe(429);
    expect(responses[60].headers.get("retry-after")).toBe("1");
  });
});
