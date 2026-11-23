// @vitest-environment node
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rebuildItemIndexes } from "../scripts/build-tarkov-snapshot.mjs";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { GET } from "@/app/api/tarkov/route";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import {
  parsePriceFeed,
  PRICE_FEED_FORMAT,
  priceFeedOrigin,
  priceFeedUrl,
  projectPriceRows,
  type PricedItem,
} from "@/app/lib/api/price-feed";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { SITE_ORIGIN } from "@/app/lib/site";
import {
  canReuseSnapshot,
  clearTarkovResourceCache,
  executeTarkovOperation,
  getGroupItems,
  getGunPartLookup,
  getItemDetail,
  runTarkovRead,
  settleTarkovRefreshes,
  type DataSnapshot,
  type PriceSourceInfo,
  type TarkovReadOptions,
} from "@/app/lib/api/tarkov-server";
import { createTarkovFixtures } from "./fixtures/tarkov";
import { writeTarkovSnapshot } from "./fixtures/tarkov-snapshot";

// The price feed: instances take item prices from our CDN-cached feed and static item data from the
// copy in hand, never downloading the items file for a price, and fall back to it when the feed fails.

const FEED_ORIGIN = "http://feed.test";
const HOUR = 60 * 60_000;

type Fixtures = Record<string, any>;

let fixtures: Fixtures;
let feedFixtures: Fixtures;
let feedAgeMs: number;
let feedStale: boolean;
let feedResponse: ((url: URL) => Response | Promise<Response>) | null;
let upstreamDown: boolean;
let snapshotDir: string | null;
let hanging: Array<() => void>;

function feedWire(items: Fixtures, overrides: Record<string, unknown> = {}) {
  return {
    format: PRICE_FEED_FORMAT,
    gameMode: "regular",
    fetchedAt: Date.now() - feedAgeMs,
    source: "tarkov.dev",
    stale: feedStale,
    etag: '"items-2"',
    lastModified: "Mon, 23 Nov 2026 08:20:25 GMT",
    ...projectPriceRows(Object.values(items.data.items) as PricedItem[]),
    ...overrides,
  };
}

const requests = () => vi.mocked(globalThis.fetch).mock.calls.map(([input]) => new URL(String(input)));
const feedRequests = () => requests().filter((url) => url.pathname === "/api/tarkov");
const upstreamRequests = (resource: string) => requests().filter((url) => url.pathname.endsWith(`/${resource}`));

/** The fixtures with every price halved and a 24-hour low added: an older copy of the same items. */
function withOldPrices(source: Fixtures): Fixtures {
  const copy = structuredClone(source);
  for (const item of Object.values<any>(copy.items.data.items)) {
    for (const field of ["lastLowPrice", "avg24hPrice", "changeLast48hPercent"]) {
      if (typeof item[field] === "number") item[field] /= 2;
    }
    item.low24hPrice = 1;
    for (const offer of [...(item.buyFromTrader ?? []), ...(item.sellToTrader ?? [])]) offer.priceRUB /= 2;
  }
  return copy;
}

async function read<T>(work: () => Promise<T>, options: TarkovReadOptions = {}) {
  const seen = { stale: false, ageMs: null as number | null, price: undefined as PriceSourceInfo | undefined, snapshot: [] as DataSnapshot };
  const data = await runTarkovRead(work, {
    maxStaleMs: Number.POSITIVE_INFINITY,
    ...options,
    onStale: () => {
      seen.stale = true;
    },
    onDataAge: (ageMs) => {
      seen.ageMs = ageMs;
    },
    onPriceSource: (info) => {
      seen.price = info;
    },
    onSnapshot: (snapshot) => {
      seen.snapshot = snapshot;
    },
  });
  return { data, ...seen };
}

const rifle = () => getGroupItems("regular", ["Test Rifle"]).then(([item]) => item);
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

beforeEach(() => {
  clearTarkovResourceCache();
  resetRequestBudgets();
  vi.stubEnv("PRICE_FEED_ORIGIN", FEED_ORIGIN);
  vi.stubEnv("VERCEL", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  fixtures = createTarkovFixtures();
  feedFixtures = fixtures;
  feedAgeMs = 30_000;
  feedStale = false;
  feedResponse = null;
  upstreamDown = false;
  snapshotDir = null;
  hanging = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (url.pathname === "/api/tarkov") {
      if (feedResponse) return feedResponse(url);
      return Response.json({ data: feedWire(feedFixtures.items) });
    }
    if (upstreamDown) return new Response("bad gateway", { status: 502 });
    const resource = url.pathname.split("/").pop()!;
    // The snapshot's items copy is "items-1"; tarkov.dev has moved on since.
    const etag = `"${resource}-${resource === "items" ? 2 : 1}"`;
    if ((init?.headers as Record<string, string> | undefined)?.["If-None-Match"] === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    return new Response(JSON.stringify(fixtures[resource]), { status: 200, headers: { ETag: etag } });
  });
});

afterEach(async () => {
  for (const fail of hanging) fail();
  vi.useRealTimers();
  await settleTarkovRefreshes();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (snapshotDir) await rm(snapshotDir, { recursive: true, force: true });
});

/** A deployment snapshot of the items with older prices, as a new deployment's instances start from. */
async function oldSnapshot(ageMs = 26 * HOUR) {
  snapshotDir = await writeTarkovSnapshot(withOldPrices(fixtures), ageMs);
}

function hangFeed() {
  feedResponse = () =>
    new Promise<Response>((_, reject) => hanging.push(() => reject(new DOMException("aborted", "AbortError"))));
}

describe("prices from the feed", () => {
  it("give the same item, detail and gun part prices as the items file", async () => {
    vi.stubEnv("PRICE_FEED_ORIGIN", "");
    const bulk = await read(() =>
      Promise.all([
        getGroupItems("regular", ["Test Rifle", "Test Mod", "Test Ammo"]),
        getItemDetail("regular", { name: "Test Rifle" }),
        getItemDetail("regular", { name: "Reward" }),
        getGunPartLookup("regular").then((lookup) => Object.fromEntries(lookup)),
      ])
    );
    expect(feedRequests()).toHaveLength(0);

    clearTarkovResourceCache();
    vi.mocked(globalThis.fetch).mockClear();
    vi.stubEnv("PRICE_FEED_ORIGIN", FEED_ORIGIN);
    await oldSnapshot();
    const merged = await read(() =>
      Promise.all([
        getGroupItems("regular", ["Test Rifle", "Test Mod", "Test Ammo"]),
        getItemDetail("regular", { name: "Test Rifle" }),
        getItemDetail("regular", { name: "Reward" }),
        getGunPartLookup("regular").then((lookup) => Object.fromEntries(lookup)),
      ])
    );
    expect(merged.data).toEqual(bulk.data);
    expect(merged.data[0][0].sellFor).toContainEqual({ vendor: { name: "Flea Market" }, priceRUB: 50_000 });
    expect(feedRequests()).toHaveLength(1);
    expect(upstreamRequests("items")).toHaveLength(0);
  });

  it("date the result by the feed, not the static copy, and name the feed as the price source", async () => {
    await oldSnapshot();
    const result = await read(rifle, { staleWaitMs: 2_500 });
    expect(result.stale).toBe(false);
    expect(result.ageMs).toBeGreaterThanOrEqual(30_000);
    expect(result.ageMs).toBeLessThan(35_000);
    expect(result.price).toMatchObject({ source: "feed", stale: false });
    expect(result.price!.ageMs).toBeGreaterThanOrEqual(30_000);
  });

  it("say the prices are stale when the origin served an old items copy", async () => {
    await oldSnapshot();
    feedStale = true;
    feedAgeMs = 2 * HOUR;
    const result = await read(rifle);
    expect(result.stale).toBe(true);
    expect(result.ageMs).toBeGreaterThanOrEqual(2 * HOUR);
    expect(result.price).toMatchObject({ source: "feed", stale: true });
  });

  it("blank the prices of items the feed no longer lists", async () => {
    await oldSnapshot();
    feedFixtures = structuredClone(fixtures);
    delete feedFixtures.items.data.items.mod;
    const { data } = await read(() => getGroupItems("regular", ["Test Mod"]));
    expect(data[0].buyFor).toEqual([]);
    expect(data[0].sellFor).toEqual([]);
  });

  it("make one feed request for many concurrent reads, and share the copy across reads", async () => {
    await oldSnapshot();
    const results = await Promise.all(Array.from({ length: 20 }, () => read(rifle, { staleWaitMs: 2_500 })));
    expect(new Set(results.map(({ data }) => data.sellFor.at(-1)?.priceRUB))).toEqual(new Set([50_000]));
    expect(feedRequests()).toHaveLength(1);
    await read(() => getItemDetail("regular", { name: "Test Mod" }));
    expect(feedRequests()).toHaveLength(1);
    expect(upstreamRequests("items")).toHaveLength(0);
  });

  it("keep the copy for a minute, then refresh it in the background", async () => {
    await oldSnapshot();
    await read(rifle);
    vi.useFakeTimers({ toFake: ["Date"] });
    later(50_000);
    await read(rifle);
    expect(feedRequests()).toHaveLength(1);

    later(15_000);
    const due = await read(rifle);
    // Served at once from the copy, which is now 95 seconds old, while a new one loads.
    expect(due.stale).toBe(false);
    expect(due.price!.ageMs).toBeGreaterThanOrEqual(95_000);
    await settleTarkovRefreshes();
    expect(feedRequests()).toHaveLength(2);
    expect((await read(rifle)).price!.ageMs).toBeLessThan(35_000);
  });

  it("past two minutes, wait only staleWaitMs for the feed, then take the copy marked stale", async () => {
    await oldSnapshot();
    await read(rifle);
    vi.useFakeTimers({ toFake: ["Date"] });
    later(3 * 60_000);
    hangFeed();
    const result = await read(rifle, { staleWaitMs: 50 });
    expect(result.stale).toBe(true);
    expect(result.price).toMatchObject({ source: "feed", stale: true });
    expect(result.data.sellFor.at(-1)?.priceRUB).toBe(50_000);
    expect(upstreamRequests("items")).toHaveLength(0);
  });

  it("on a cold instance with a slow feed, use the static copy's own prices, marked stale", async () => {
    await oldSnapshot();
    hangFeed();
    const result = await read(rifle, { staleWaitMs: 50 });
    expect(result.stale).toBe(true);
    expect(result.price).toMatchObject({ source: "snapshot", stale: true });
    expect(result.data.sellFor.at(-1)?.priceRUB).toBe(25_000);
    expect(upstreamRequests("items")).toHaveLength(0);
  });

  it("let a result built from the feed be reused until the feed copy changes", async () => {
    await oldSnapshot();
    const { snapshot } = await read(rifle);
    expect(snapshot.map(([key]) => key)).toEqual(expect.arrayContaining(["regular/prices", "regular/items#static"]));
    // The static copy is 26 hours old, but only its prices would make it stale, and those come from the feed.
    expect(canReuseSnapshot(snapshot)).toBe(true);
    expect(upstreamRequests("items")).toHaveLength(0);

    vi.useFakeTimers({ toFake: ["Date"] });
    later(61_000);
    feedAgeMs = 0;
    expect(canReuseSnapshot(snapshot)).toBe(true);
    await settleTarkovRefreshes();
    expect(feedRequests()).toHaveLength(2);
    expect(canReuseSnapshot(snapshot)).toBe(false);
  });
});

describe("when the feed fails", () => {
  it("fall back to the items file, then to the snapshot, and never fail while a copy exists", async () => {
    await oldSnapshot();
    feedResponse = () => new Response("bad gateway", { status: 502 });
    const fromFile = await read(rifle);
    expect(fromFile.data.sellFor.at(-1)?.priceRUB).toBe(50_000);
    expect(fromFile.price).toMatchObject({ source: "items-file", stale: false });
    expect(upstreamRequests("items")).toHaveLength(1);

    clearTarkovResourceCache();
    upstreamDown = true;
    const fromSnapshot = await read(rifle);
    expect(fromSnapshot.data.sellFor.at(-1)?.priceRUB).toBe(25_000);
    expect(fromSnapshot.stale).toBe(true);
    expect(fromSnapshot.price).toMatchObject({ source: "snapshot", stale: true });
    expect(fromSnapshot.ageMs).toBeGreaterThanOrEqual(26 * HOUR);
  });

  it("fall back to the items file on a preview whose protection refuses the feed", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "preview.test");
    feedResponse = () => new Response("unauthorized", { status: 401 });
    const result = await read(rifle);
    expect(feedRequests().map((url) => url.origin)).toEqual(["https://preview.test"]);
    expect(result.data.sellFor.at(-1)?.priceRUB).toBe(50_000);
    expect(result.price).toMatchObject({ source: "items-file" });
  });

  it("treat a feed in an unexpected shape as a failure", async () => {
    await oldSnapshot();
    feedResponse = () => Response.json({ data: feedWire(fixtures.items, { format: PRICE_FEED_FORMAT + 1 }) });
    const result = await read(rifle);
    expect(result.price).toMatchObject({ source: "items-file" });
    expect(upstreamRequests("items")).toHaveLength(1);
  });

  it("keep the newer prices when the feed's last copy beats the items copy in hand", async () => {
    await oldSnapshot();
    await read(rifle);
    vi.useFakeTimers({ toFake: ["Date"] });
    later(3 * 60_000);
    feedResponse = () => new Response("bad gateway", { status: 502 });
    upstreamDown = true;
    const result = await read(rifle);
    // The feed copy is 3.5 minutes old, the snapshot 26 hours: the feed's prices, marked stale.
    expect(result.data.sellFor.at(-1)?.priceRUB).toBe(50_000);
    expect(result.price).toMatchObject({ source: "feed", stale: true });
    expect(result.ageMs).toBeLessThan(4 * 60_000);
  });

  it("open a circuit breaker: no requests while it's open, one probe after, backing off from 10 seconds", async () => {
    await oldSnapshot();
    feedResponse = () => new Response("bad gateway", { status: 502 });
    await read(rifle);
    expect(feedRequests()).toHaveLength(1);

    // Open: reads take the items file at once, without asking the feed.
    await Promise.all(Array.from({ length: 20 }, () => read(rifle)));
    expect(feedRequests()).toHaveLength(1);

    vi.useFakeTimers({ toFake: ["Date"] });
    later(10_001);
    // Half-open: one probe, in the background; the read doesn't wait for it.
    await Promise.all(Array.from({ length: 5 }, () => read(rifle)));
    await settleTarkovRefreshes();
    expect(feedRequests()).toHaveLength(2);

    // It failed, so the wait doubles to 20 seconds.
    later(15_000);
    await read(rifle);
    expect(feedRequests()).toHaveLength(2);
    later(5_001);
    feedResponse = null;
    await read(rifle);
    await settleTarkovRefreshes();
    expect(feedRequests()).toHaveLength(3);
    expect((await read(rifle)).price).toMatchObject({ source: "feed", stale: false });
  });

  it("honour Retry-After", async () => {
    await oldSnapshot();
    feedResponse = () => new Response("slow down", { status: 429, headers: { "Retry-After": "300" } });
    await read(rifle);
    vi.useFakeTimers({ toFake: ["Date"] });
    later(4 * 60_000);
    await read(rifle);
    expect(feedRequests()).toHaveLength(1);
    later(61_000);
    await read(rifle);
    await settleTarkovRefreshes();
    expect(feedRequests()).toHaveLength(2);
  });
});

describe("patch detection", () => {
  it("loads the items file once in the background when the feed lists items the copy lacks", async () => {
    await oldSnapshot();
    fixtures.items.data.items.newitem = { id: "newitem", name: "new-name", normalizedName: "new-item", lastLowPrice: 777 };
    feedFixtures = fixtures;
    const ids = () => executeTarkovOperation(TARKOV_OPERATIONS.buildItems, { gameMode: "regular", ids: ["newitem"] });
    expect(await ids()).toEqual([]);
    await ids();
    await settleTarkovRefreshes();
    expect(upstreamRequests("items")).toHaveLength(1);
    expect(await ids()).toMatchObject([{ id: "newitem", fleaPriceRUB: 777 }]);
    expect(upstreamRequests("items")).toHaveLength(1);
  });
});

describe("the price.feed operation", () => {
  // The URL instances ask for.
  const url = priceFeedUrl("http://localhost", "regular");

  it("builds the feed from the items file, with a one-minute shared cache, never reading the feed", async () => {
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=60");
    const feed = parsePriceFeed((await response.json()).data, "regular");
    expect(feed).toMatchObject({ gameMode: "regular", stale: false, source: "tarkov.dev", etag: '"items-2"' });
    expect(feed!.prices.get("weapon")).toMatchObject({ lastLowPrice: 50_000, sellToTrader: [{ trader: "trader", priceRUB: 20_000 }] });
    expect(feedRequests().filter((request) => request.origin === FEED_ORIGIN)).toHaveLength(0);
    expect(upstreamRequests("items")).toHaveLength(1);
  });

  it("revalidates its items copy after a minute, and marks the feed stale with a short cache when that fails", async () => {
    await GET(new Request(url));
    vi.useFakeTimers({ toFake: ["Date"] });
    later(30_000);
    await GET(new Request(url));
    expect(upstreamRequests("items")).toHaveLength(1);

    later(31_000);
    const revalidated = await GET(new Request(url));
    expect(upstreamRequests("items")).toHaveLength(2);
    expect((await revalidated.json()).data.fetchedAt).toBeGreaterThan(Date.now() - 1_000);

    later(61_000);
    upstreamDown = true;
    const stale = await GET(new Request(url));
    expect(stale.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=30");
    expect((await stale.json()).data).toMatchObject({ stale: true });
  });
});

describe("parsePriceFeed", () => {
  const wire = () => feedWire(fixtures.items);

  it("reads a valid feed", () => {
    const feed = parsePriceFeed(wire(), "regular")!;
    expect(feed.prices.get("weapon")).toEqual({
      lastLowPrice: 50_000,
      avg24hPrice: 55_000,
      low24hPrice: null,
      high24hPrice: null,
      lastOfferCount: null,
      changeLast48hPercent: 5,
      updated: null,
      sellToTrader: [{ trader: "trader", priceRUB: 20_000 }],
      buyFromTrader: [
        { trader: "trader", priceRUB: 45_000, minTraderLevel: 1, taskUnlock: null },
        { trader: "trader", priceRUB: 40_000, minTraderLevel: 3, taskUnlock: null },
      ],
    });
    expect([...feed.prices.keys()]).toEqual(Object.keys(fixtures.items.data.items));
  });

  it.each([
    ["another format", (feed: any) => (feed.format = 2)],
    ["another game mode", (feed: any) => (feed.gameMode = "pve")],
    ["no fetchedAt", (feed: any) => delete feed.fetchedAt],
    ["an unknown source", (feed: any) => (feed.source = "elsewhere")],
    ["a short row", (feed: any) => feed.items[0].pop()],
    ["a price that isn't a number", (feed: any) => (feed.items[0][1] = "50000")],
    ["a trader index out of range", (feed: any) => (feed.items[0][8][0] = 99)],
    ["a half sell offer", (feed: any) => feed.items[0][8].pop()],
    ["a bad task id", (feed: any) => (feed.items[0][9][3] = 5)],
    ["a repeated item", (feed: any) => feed.items.push(feed.items[0])],
    ["an empty id", (feed: any) => (feed.items[0][0] = "")],
  ])("refuses %s", (_, spoil) => {
    const feed = wire();
    spoil(feed);
    expect(parsePriceFeed(feed, "regular")).toBeNull();
  });
});

describe("priceFeedOrigin", () => {
  it("is the site in production, the deployment on a preview, PRICE_FEED_ORIGIN locally, and off otherwise", () => {
    expect(priceFeedOrigin()).toBe(FEED_ORIGIN);
    vi.stubEnv("PRICE_FEED_ORIGIN", "");
    expect(priceFeedOrigin()).toBeNull();
    vi.stubEnv("PRICE_FEED_ORIGIN", "http://localhost:3000/");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(priceFeedOrigin()).toBe(SITE_ORIGIN);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "eft-toolset-abc.vercel.app");
    expect(priceFeedOrigin()).toBe("https://eft-toolset-abc.vercel.app");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(priceFeedOrigin()).toBeNull();
  });

  it("leaves reads exactly as before when off", async () => {
    vi.stubEnv("PRICE_FEED_ORIGIN", "");
    const result = await read(rifle);
    expect(feedRequests()).toHaveLength(0);
    expect(upstreamRequests("items")).toHaveLength(1);
    expect(result.price).toMatchObject({ source: "items-file" });
  });
});

describe("MCP price source", () => {
  async function itemPrices() {
    const response = await mcpPost(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_item_prices", arguments: { items: ["Test Rifle"] } },
        }),
      })
    );
    return (await response.json()).result.structuredContent as Record<string, unknown>;
  }

  it("says the prices are live from the feed, and the snapshot's when nothing else answers", async () => {
    await oldSnapshot();
    // As in a deployment: the item index resolves names, so nothing loads the items file.
    await rebuildItemIndexes(snapshotDir!, { info: () => undefined, warn: () => undefined });
    const live = await itemPrices();
    expect(live.priceSource).toEqual({ kind: "live", ageSeconds: 30 });
    expect(live.dataNotice).toBeUndefined();
    expect(upstreamRequests("items")).toHaveLength(0);

    clearTarkovResourceCache();
    feedResponse = () => new Response("bad gateway", { status: 502 });
    upstreamDown = true;
    const fallback = await itemPrices();
    expect(fallback.priceSource).toMatchObject({ kind: "snapshot" });
    expect(fallback.dataNotice).toMatch(/bundled with this server/);
  });
});
