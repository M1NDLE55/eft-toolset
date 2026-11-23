// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScheduledRefresh } from "@/app/lib/api/scheduled";
import { priceFeedStoreKey } from "@/app/lib/api/price-feed";
import { clearTarkovResourceCache, settleTarkovRefreshes } from "@/app/lib/api/tarkov-server";
import { setPlatform } from "@/app/lib/server/platform";
import { createTarkovFixtures } from "./fixtures/tarkov";

let fixtures: Record<string, unknown>;
let requests: { path: string; ifNoneMatch?: string }[];
let values: Map<string, string>;
let etag: number;

beforeEach(() => {
  clearTarkovResourceCache();
  fixtures = createTarkovFixtures();
  requests = [];
  values = new Map();
  etag = 1;
  setPlatform({
    sharedStore: {
      get: async (key) => values.get(key) ?? null,
      put: async (key, value) => {
        values.set(key, value);
      },
    },
  });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const ifNoneMatch = (init?.headers as Record<string, string> | undefined)?.["If-None-Match"];
    requests.push({ path: url.pathname, ifNoneMatch });
    const resource = url.pathname.split("/").pop()!;
    const current = `"${resource}-${resource === "items" ? etag : 1}"`;
    if (ifNoneMatch === current) return new Response(null, { status: 304, headers: { ETag: current } });
    return new Response(JSON.stringify(fixtures[resource]), { status: 200, headers: { ETag: current } });
  });
});

afterEach(async () => {
  await settleTarkovRefreshes();
  setPlatform();
  vi.restoreAllMocks();
});

const feed = (gameMode: string) => JSON.parse(values.get(priceFeedStoreKey(gameMode as "regular"))!).data;

describe("the cron", () => {
  it("publishes each mode's price feed, then only confirms it while tarkov.dev's items file is unchanged", async () => {
    const first = await runScheduledRefresh(Date.now());
    expect(first["regular/price-feed"]).toBe("published");
    expect(first["pve/price-feed"]).toBe("published");
    expect(feed("regular")).toMatchObject({ gameMode: "regular", etag: '"items-1"', source: "tarkov.dev", stale: false });
    const publishedAt = feed("regular").fetchedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    requests = [];
    const second = await runScheduledRefresh(Date.now());
    expect(second["regular/price-feed"]).toBe("confirmed");
    expect(requests.filter((request) => request.path.endsWith("/items"))).toEqual([
      { path: "/regular/items", ifNoneMatch: '"items-1"' },
      { path: "/pve/items", ifNoneMatch: '"items-1"' },
    ]);
    expect(feed("regular").fetchedAt).toBeGreaterThan(publishedAt);

    etag = 2;
    expect((await runScheduledRefresh(Date.now()))["regular/price-feed"]).toBe("published");
    expect(feed("regular").etag).toBe('"items-2"');
  });

  it("keeps the shared datasets fresh, asking tarkov.dev only once a copy is due", async () => {
    const first = await runScheduledRefresh(Date.now());
    expect(first["regular/maps"]).toBe("updated");
    expect(first["pve/traders"]).toBe("updated");
    expect([...values.keys()].some((key) => key.startsWith("tarkov:1:regular/maps:body:"))).toBe(true);
    // The items file is never shared: instances get prices from the feed.
    expect([...values.keys()].some((key) => key.includes("/items:"))).toBe(false);

    requests = [];
    const second = await runScheduledRefresh(Date.now());
    expect(second["regular/maps"]).toBe("fresh");
    expect(requests.filter((request) => !request.path.endsWith("/items"))).toEqual([]);
  });

  it("carries on with the other steps when one fails", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) =>
      String(input).endsWith("/regular/maps") ? new Response("down", { status: 502 }) : new Response(JSON.stringify(fixtures[String(input).split("/").pop()!]), { headers: { ETag: '"x"' } })
    );
    const outcomes = await runScheduledRefresh(Date.now());
    expect(outcomes["regular/maps"]).toMatch(/^failed: /);
    expect(outcomes["regular/tasks"]).toBe("updated");
    expect(outcomes["pve/price-feed"]).toBe("published");
  });
});
