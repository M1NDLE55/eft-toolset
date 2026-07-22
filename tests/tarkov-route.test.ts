import { describe, expect, it } from "vitest";
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
});
