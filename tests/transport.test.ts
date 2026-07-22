import { describe, expect, it, vi } from "vitest";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import { apiFetch } from "@/app/lib/api/transport";

describe("typed API transport", () => {
  it("posts an allowlisted operation and returns its data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "item-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(
      apiFetch<{ id: string }[]>(
        TARKOV_OPERATIONS.itemCatalog,
        { gameMode: "regular" },
        { retries: 0 }
      )
    ).resolves.toEqual([{ id: "item-1" }]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tarkov",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operation: TARKOV_OPERATIONS.itemCatalog,
          variables: { gameMode: "regular" },
        }),
      })
    );
  });

  it("returns typed API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Unavailable", code: "UPSTREAM_UNAVAILABLE" } }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const request = apiFetch(
      TARKOV_OPERATIONS.itemCatalog,
      { gameMode: "regular" },
      { retries: 0 }
    );
    await expect(request).rejects.toMatchObject({
      kind: "http",
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Unavailable",
    });
  });

  it("classifies unreadable HTTP responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 502 }));
    await expect(
      apiFetch(
        TARKOV_OPERATIONS.itemCatalog,
        { gameMode: "regular" },
        { retries: 0 }
      )
    ).rejects.toMatchObject({ kind: "decode", status: 502 });
  });
});
