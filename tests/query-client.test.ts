import { describe, expect, it, vi } from "vitest";
import { ensureQuery, type QueryDefinition } from "@/app/lib/api/queryClient";

describe("query client", () => {
  it("deduplicates concurrent requests and reuses fresh data", async () => {
    let resolve!: (value: string) => void;
    const fetcher = vi.fn(
      () => new Promise<string>((done) => { resolve = done; })
    );
    const query: QueryDefinition<{ id: string }, string> = {
      id: `dedupe-${crypto.randomUUID()}`,
      version: 1,
      staleTime: 60_000,
      maxAge: 120_000,
      fetch: fetcher,
    };

    const first = ensureQuery(query, { id: "a" });
    const second = ensureQuery(query, { id: "a" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    resolve("result");

    await expect(Promise.all([first, second])).resolves.toEqual(["result", "result"]);
    await expect(ensureQuery(query, { id: "a" })).resolves.toBe("result");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
