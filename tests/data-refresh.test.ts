// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptedSockets, durableEnv } from "./helpers/durable-env";
import { PRICE_FEED_FORMAT, clearPriceFeedCache } from "@/app/lib/api/price-feed";
import { priceFeedStoreKey, type DataRefresher } from "@/app/lib/api/refresher";
import { DEFAULT_SCHEDULE_CONFIG } from "@/app/lib/api/refresh-schedule";
import { setPlatform } from "@/app/lib/server/platform";
import {
  clearTarkovResourceCache,
  getGroupItems,
  getItemDetail,
  runTarkovRead,
  settleTarkovRefreshes,
  type PriceSourceInfo,
} from "@/app/lib/api/tarkov-server";
import type { PriceUpdate } from "@/app/lib/prices/live-protocol";
import { createTarkovFixtures } from "./fixtures/tarkov";
import { writeTarkovSnapshot } from "./fixtures/tarkov-snapshot";
import { setTarkovSnapshotDirForTests } from "@/app/lib/api/tarkov-snapshot";
import { rm } from "node:fs/promises";

// The refresher (DataRefreshDO): the only caller of tarkov.dev for prices and the shared datasets.
// It checks only when a check is due, shares one check among every caller, writes KV only when
// something changed, and pushes the price version to open pages.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
type Fixtures = Record<string, any>;

let durable: ReturnType<typeof durableEnv>;
let fixtures: Fixtures;
/** tarkov.dev's current items file: its number and when it was published. */
let items: { version: number; publishedAt: number };
let upstreamDown: boolean;
let upstream: { path: string; conditional: boolean; status: number }[];
/** The other datasets' versions upstream (1 = the deployment snapshot's). */
let datasetVersions: Record<string, number>;
let snapshotDir: string;

const itemsChecks = (gameMode = "regular") => upstream.filter((request) => request.path === `/${gameMode}/items`);
const datasetChecks = (resource: string) => upstream.filter((request) => request.path.endsWith(`/${resource}`));
const pricePuts = (gameMode = "regular") => durable.kv.puts.filter((key) => key === priceFeedStoreKey(gameMode as "regular", PRICE_FEED_FORMAT));
const service = (gameMode = "regular") => durable.DATA_REFRESH.getByName(gameMode) as unknown as DataRefresher;
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

/** tarkov.dev publishes a new items file now, with every price changed. */
function publishItems() {
  items = { version: items.version + 1, publishedAt: Math.floor(Date.now() / 1000) * 1000 };
  for (const item of Object.values<any>(fixtures.items.data.items)) if (typeof item.lastLowPrice === "number") item.lastLowPrice += 1;
}

/** A new isolate: nothing in memory, so it starts from KV and the refresher. */
function newIsolate() {
  clearTarkovResourceCache();
  clearPriceFeedCache();
}

async function read<T>(work: () => Promise<T>) {
  let price: PriceSourceInfo | undefined;
  const data = await runTarkovRead(work, { maxStaleMs: Number.POSITIVE_INFINITY, onPriceSource: (info) => (price = info) });
  return { data, price };
}

const rifle = () => getGroupItems("regular", ["Test Rifle"]).then(([item]) => item);

function openSocket(gameMode = "regular") {
  const before = acceptedSockets.length;
  return durable.DATA_REFRESH.raw(gameMode)
    .fetch(new Request(`https://refresher.internal/live?mode=${gameMode}`, { headers: { Upgrade: "websocket" } }))
    .then((response) => {
      expect(response.status).toBe(101);
      return acceptedSockets[before];
    });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 10, 26, 8, 0, 30));
  clearTarkovResourceCache();
  clearPriceFeedCache();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  durable = durableEnv();
  fixtures = createTarkovFixtures();
  items = { version: 1, publishedAt: Date.UTC(2026, 10, 26, 8, 0, 23) };
  upstreamDown = false;
  upstream = [];
  datasetVersions = {};
  // Instances start from a day-old deployment snapshot, as in production.
  snapshotDir = await writeTarkovSnapshot(fixtures, 26 * HOUR);
  setPlatform({
    sharedStore: {
      get: async (key: string) => durable.kv.values.get(key) ?? null,
      put: async (key: string, value: string) => void durable.kv.values.set(key, value),
    },
    refresher: (gameMode) => service(gameMode),
    durable: durable.env,
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const resource = url.pathname.split("/").pop()!;
    const conditional = "If-None-Match" in headers || "If-Modified-Since" in headers;
    const record = (status: number) => upstream.push({ path: url.pathname, conditional, status });
    if (upstreamDown) {
      record(502);
      return new Response("bad gateway", { status: 502 });
    }
    const etag = `"${resource}-${resource === "items" ? items.version : (datasetVersions[resource] ?? 1)}"`;
    const lastModified = new Date(resource === "items" ? items.publishedAt : Date.UTC(2026, 10, 25)).toUTCString();
    const common = { ETag: etag, "Last-Modified": lastModified, Date: new Date().toUTCString() };
    if (headers["If-None-Match"] === etag) {
      record(304);
      return new Response(null, { status: 304, headers: common });
    }
    record(200);
    return new Response(JSON.stringify(fixtures[resource]), { status: 200, headers: common });
  });
});

afterEach(async () => {
  await settleTarkovRefreshes();
  setPlatform();
  setTarkovSnapshotDirForTests(null);
  await rm(snapshotDir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the refresher's price checks", () => {
  it("make one upstream request for many callers at once, and none until the next change is due", async () => {
    const answers = await Promise.all(Array.from({ length: 25 }, () => service().prices("regular", null)));
    expect(itemsChecks()).toHaveLength(1);
    expect(new Set(answers.map((answer) => answer.version)).size).toBe(1);
    expect(answers.every((answer) => typeof answer.body === "string")).toBe(true);
    // Predicted: the change after 08:00:23 is due at 08:10:23, checked a margin later.
    // (Within a second: tarkov.dev's Date header has whole seconds.)
    expect(Math.abs(answers[0].nextCheckAt - (Date.UTC(2026, 10, 26, 8, 10, 23) + DEFAULT_SCHEDULE_CONFIG.marginMs))).toBeLessThanOrEqual(1_000);

    later(5 * MINUTE);
    const early = await Promise.all(Array.from({ length: 25 }, () => service().prices("regular", answers[0].version)));
    expect(itemsChecks()).toHaveLength(1);
    // Callers holding the current version get no body.
    expect(early.every((answer) => answer.body === undefined)).toBe(true);
  });

  it("write the feed to KV only when tarkov.dev publishes new prices; a 304 writes nothing", async () => {
    const first = await service().prices("regular", null);
    expect(pricePuts()).toHaveLength(1);

    vi.setSystemTime(first.nextCheckAt);
    const unchanged = await service().prices("regular", first.version);
    expect(itemsChecks().map((check) => check.status)).toEqual([200, 304]);
    expect(unchanged.version).toBe(first.version);
    expect(unchanged.confirmedAt).toBe(first.nextCheckAt);
    expect(pricePuts()).toHaveLength(1);

    vi.setSystemTime(unchanged.nextCheckAt);
    publishItems();
    const changed = await service().prices("regular", first.version);
    expect(changed.version).toBeGreaterThan(first.version!);
    expect(JSON.parse(changed.body!).data.version).toBe(changed.version);
    expect(pricePuts()).toHaveLength(2);
  });

  it("back off after a 304 at the predicted time, rather than check on every request", async () => {
    const first = await service().prices("regular", null);
    for (let second = 0; second < 5 * 60; second += 5) {
      vi.setSystemTime(first.nextCheckAt + second * 1000);
      await service().prices("regular", first.version);
    }
    // 304s at +0, +1, +3 minutes: not one per request.
    expect(itemsChecks().filter((check) => check.status === 304).length).toBeLessThanOrEqual(3);
  });

  it("ignore an items file older than the one held (a lagging cache upstream)", async () => {
    const first = await service().prices("regular", null);
    vi.setSystemTime(first.nextCheckAt);
    items = { version: 7, publishedAt: items.publishedAt - 10 * MINUTE };
    const answer = await service().prices("regular", first.version);
    expect(answer.version).toBe(first.version);
    expect(pricePuts()).toHaveLength(1);
  });

  it("keep the old prices, marked stale, when tarkov.dev fails, and try again after a backoff", async () => {
    const first = await service().prices("regular", null);
    vi.setSystemTime(first.nextCheckAt);
    upstreamDown = true;
    const failed = await service().prices("regular", first.version);
    expect(failed).toMatchObject({ version: first.version, stale: true });
    expect(failed.nextCheckAt).toBeGreaterThan(Date.now());
    const requests = upstream.length;
    await service().prices("regular", first.version);
    expect(upstream.length).toBe(requests);
  });

  it("keep their schedule and serve the feed from KV after the object is evicted", async () => {
    const first = await service().prices("regular", null);
    durable.DATA_REFRESH.restart("regular");
    const answer = await service().prices("regular", null);
    expect(itemsChecks()).toHaveLength(1);
    expect(answer).toMatchObject({ version: first.version, nextCheckAt: first.nextCheckAt });
    expect(answer.body).toBe(first.body);
  });

  it("fetch the file afresh if the feed body was lost", async () => {
    const first = await service().prices("regular", null);
    durable.DATA_REFRESH.restart("regular");
    durable.kv.values.clear();
    const answer = await service().prices("regular", null);
    expect(itemsChecks().map((check) => check.conditional)).toEqual([false, false]);
    expect(answer.version).toBeGreaterThan(first.version!);
    expect(answer.body).toBeDefined();
  });

  it("take turns between the modes, so one isolate never holds two items files at once", async () => {
    let downloading = 0;
    let most = 0;
    const answer = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (!String(input).endsWith("/items")) return answer(input, init);
      downloading += 1;
      most = Math.max(most, downloading);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await answer(input, init);
      } finally {
        downloading -= 1;
      }
    });
    await Promise.all([service("regular").prices("regular", null), service("pve").prices("pve", null)]);
    expect(itemsChecks("regular")).toHaveLength(1);
    expect(itemsChecks("pve")).toHaveLength(1);
    expect(most).toBe(1);
  });

  it("keep PVP and PVE apart", async () => {
    await service("regular").prices("regular", null);
    await service("pve").prices("pve", null);
    expect(itemsChecks("regular")).toHaveLength(1);
    expect(itemsChecks("pve")).toHaveLength(1);
    await expect(service("regular").prices("pve", null)).rejects.toThrow(/serves regular/);
  });

  it("make no requests at all without callers", async () => {
    await service().prices("regular", null);
    later(6 * HOUR);
    await durable.runAlarms();
    expect(upstream).toHaveLength(1);
  });
});

describe("instances reading prices through the refresher", () => {
  it("serve a due copy at once and pick up the new prices in the background", async () => {
    const cold = await read(rifle);
    expect(cold.price).toMatchObject({ source: "feed" });
    const before = cold.data.sellFor.at(-1)?.priceRUB;

    vi.setSystemTime(Date.UTC(2026, 10, 26, 8, 12));
    publishItems();
    const due = await read(rifle);
    // The old prices, at once.
    expect(due.data.sellFor.at(-1)?.priceRUB).toBe(before);
    await settleTarkovRefreshes();
    const fresh = await read(rifle);
    expect(fresh.data.sellFor.at(-1)?.priceRUB).toBe(before! + 1);
    expect(fresh.price!.version).toBeGreaterThan(cold.price!.version!);
  });

  it("let many isolates share the one check, and start a new isolate from KV without asking", async () => {
    await read(rifle);
    expect(itemsChecks()).toHaveLength(1);
    for (let isolate = 0; isolate < 10; isolate += 1) {
      newIsolate();
      expect((await read(rifle)).price).toMatchObject({ source: "feed" });
    }
    // Ten new isolates, no new checks: they read the feed from KV and its prediction isn't due.
    expect(itemsChecks()).toHaveLength(1);

    vi.setSystemTime(Date.UTC(2026, 10, 26, 8, 11, 30));
    publishItems();
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        newIsolate();
        await read(rifle);
      })
    );
    await settleTarkovRefreshes();
    expect(itemsChecks()).toHaveLength(2);
  });

  it("never download the items file for prices", async () => {
    await read(rifle);
    newIsolate();
    await read(rifle);
    // The refresher's one request: the isolates take static data from the deployment snapshot.
    expect(itemsChecks()).toHaveLength(1);
  });

  it("refetch for the version a pushed page asks for", async () => {
    const cold = await read(rifle);
    vi.setSystemTime(Date.UTC(2026, 10, 26, 8, 11, 30));
    publishItems();
    // Another isolate's request made the refresher check and push the new version…
    const pushed = await service().prices("regular", null);
    // …and this one, asked for it by a page, gets it before answering.
    let price: PriceSourceInfo | undefined;
    await runTarkovRead(rifle, { minPricesVersion: { gameMode: "regular", version: pushed.version! }, onPriceSource: (info) => (price = info) });
    expect(price!.version).toBe(pushed.version);
    expect(price!.version).toBeGreaterThan(cold.price!.version!);
  });
});

describe("the live price push", () => {
  it("tells a page the current version when it connects, then when a check starts and ends", async () => {
    const first = await service().prices("regular", null);
    const socket = await openSocket();
    expect(socket.last<PriceUpdate>()).toMatchObject({ type: "prices", version: first.version, checking: false });

    vi.setSystemTime(first.nextCheckAt);
    publishItems();
    await service().prices("regular", first.version);
    const messages = socket.messages<PriceUpdate>();
    expect(messages.at(-2)).toMatchObject({ checking: true, version: first.version });
    expect(messages.at(-1)!.checking).toBe(false);
    expect(messages.at(-1)!.version).toBeGreaterThan(first.version!);
  });

  it("checks on connect when a check is due, for edge-cached pages that never asked", async () => {
    const first = await service().prices("regular", null);
    vi.setSystemTime(first.nextCheckAt);
    publishItems();
    const socket = await openSocket();
    await vi.waitFor(() => expect(socket.last<PriceUpdate>()!.version).toBeGreaterThan(first.version!));
    expect(itemsChecks()).toHaveLength(2);
  });

  it("keeps an alarm for the next change only while pages are open", async () => {
    const first = await service().prices("regular", null);
    const socket = await openSocket();
    const state = durable.DATA_REFRESH.state("regular")!;
    expect(state.alarm).toBe(first.nextCheckAt);

    vi.setSystemTime(first.nextCheckAt);
    publishItems();
    await durable.runAlarms(first.nextCheckAt);
    expect(itemsChecks()).toHaveLength(2);
    expect(socket.last<PriceUpdate>()!.version).toBeGreaterThan(first.version!);

    // The page goes: the next alarm finds nobody and checks nothing, and sets no other.
    socket.close();
    vi.setSystemTime(state.alarm!);
    await durable.runAlarms(state.alarm!);
    expect(itemsChecks()).toHaveLength(2);
    expect(state.alarm).toBeNull();
  });
});

describe("the refresher's shared datasets", () => {
  it("are checked with tarkov.dev at most hourly, written to KV only when they change, and shared by every isolate", async () => {
    await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    expect(datasetChecks("crafts")).toHaveLength(1);
    const bodies = () => durable.kv.puts.filter((key) => key.includes("/crafts:body:")).length;
    expect(bodies()).toBe(1);

    for (let isolate = 0; isolate < 5; isolate += 1) {
      newIsolate();
      await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    }
    expect(datasetChecks("crafts")).toHaveLength(1);

    later(59 * MINUTE);
    newIsolate();
    await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    expect(datasetChecks("crafts")).toHaveLength(1);

    later(2 * MINUTE);
    await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    await settleTarkovRefreshes();
    expect(datasetChecks("crafts").map((check) => check.status)).toEqual([200, 304]);
    expect(bodies()).toBe(1);
    // No metadata records: only bodies, and the price feed.
    expect(durable.kv.puts.some((key) => key.endsWith(":meta"))).toBe(false);
  });

  it("write a body again when an isolate finds it missing", async () => {
    datasetVersions.crafts = 2;
    await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    for (const key of [...durable.kv.values.keys()]) if (key.includes("/crafts:body:")) durable.kv.values.delete(key);
    newIsolate();
    await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    expect(datasetChecks("crafts").map((check) => check.conditional)).toEqual([false, false]);
    expect([...durable.kv.values.keys()].some((key) => key.includes("/crafts:body:"))).toBe(true);
  });

  it("are ignored when the body fails validation: the isolate asks tarkov.dev itself", async () => {
    datasetVersions.crafts = 2;
    await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    for (const key of [...durable.kv.values.keys()]) if (key.includes("/crafts:body:")) durable.kv.values.set(key, JSON.stringify({ data: "not crafts" }));
    newIsolate();
    await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    // The refresher's check, its rewrite (which the corrupt copy prompted), and the isolate's own request.
    expect(datasetChecks("crafts").length).toBeGreaterThanOrEqual(2);
    expect(datasetChecks("crafts").at(-1)!.status).toBe(200);
  });

  it("make the isolates back off while tarkov.dev fails, serving their copies", async () => {
    await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    later(61 * MINUTE);
    upstreamDown = true;
    await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    await settleTarkovRefreshes();
    const failed = datasetChecks("crafts").length;
    for (let index = 0; index < 5; index += 1) await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    await settleTarkovRefreshes();
    expect(datasetChecks("crafts").length).toBe(failed);
  });
});
