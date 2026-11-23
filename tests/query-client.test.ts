import { describe, expect, it, vi } from "vitest";
import {
  ensureQuery,
  getQuerySnapshot,
  invalidateQuery,
  primeQuery,
  queryKey,
  type QueryDefinition,
} from "@/app/lib/api/queryClient";

describe("query client", () => {
  it("reports server-primed data as fresh until a fetch finds it old, then refreshes it", async () => {
    let resolve!: (value: string) => void;
    const fetcher = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const query: QueryDefinition<{ id: string }, string> = {
      id: `prime-${crypto.randomUUID()}`,
      version: 1,
      staleTime: 60_000,
      maxAge: 24 * 60 * 60_000,
      fetch: fetcher,
    };
    const key = queryKey(query, { id: "a" });
    // As from a cached page rendered an hour ago: hydration must see what the server rendered.
    primeQuery(query, { id: "a" }, "cached", Date.now() - 60 * 60_000);
    expect(getQuerySnapshot<string>(key)).toMatchObject({ data: "cached", stale: false });

    await expect(ensureQuery(query, { id: "a" })).resolves.toBe("cached");
    expect(getQuerySnapshot<string>(key)).toMatchObject({ data: "cached", stale: true });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    resolve("fresh");
    await vi.waitFor(() => expect(getQuerySnapshot<string>(key)).toMatchObject({ data: "fresh", stale: false }));
    expect(fetcher).toHaveBeenCalledOnce();
  });

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

  it("does not let an invalidated flight repopulate the cache", async () => {
    const resolvers: Array<(value: string) => void> = [];
    const fetcher = vi.fn(
      () => new Promise<string>((resolve) => resolvers.push(resolve))
    );
    const query: QueryDefinition<{ id: string }, string> = {
      id: `invalidate-${crypto.randomUUID()}`,
      version: 1,
      staleTime: 60_000,
      maxAge: 120_000,
      fetch: fetcher,
    };
    const variables = { id: "a" };

    const oldFlight = ensureQuery(query, variables);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await invalidateQuery(query, variables);
    const newFlight = ensureQuery(query, variables);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    const oldOutcome = expect(oldFlight).rejects.toMatchObject({ name: "AbortError" });
    resolvers[0]("old");
    await oldOutcome;
    resolvers[1]("new");
    await expect(newFlight).resolves.toBe("new");
    expect(getQuerySnapshot<string>(queryKey(query, variables)).data).toBe("new");
  });
});
