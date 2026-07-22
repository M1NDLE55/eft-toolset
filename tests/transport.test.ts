import { describe, expect, it, vi } from "vitest";
import { gqlFetch } from "@/app/lib/api/transport";

describe("GraphQL transport", () => {
  it("returns typed GraphQL errors with partial data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { items: [] }, errors: [{ message: "Unavailable" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = gqlFetch("query Items { items { id } }", {}, { retries: 0 });
    await expect(request).rejects.toMatchObject({
      kind: "graphql",
      message: "Unavailable",
      partialData: { items: [] },
    });
  });

  it("classifies unreadable HTTP responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 502 }));
    await expect(
      gqlFetch("query Items { items { id } }", {}, { retries: 0 })
    ).rejects.toMatchObject({ kind: "decode", status: 502 });
  });
});
