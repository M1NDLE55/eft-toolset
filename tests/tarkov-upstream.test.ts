import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import { setRegionalCacheForTests, type SharedCache } from "@/app/lib/api/shared-cache";
import {
  canReuseSnapshot,
  clearTarkovResourceCache,
  executeTarkovOperation,
  type DataSnapshot,
} from "@/app/lib/api/tarkov-server";
import { createTarkovFixtures } from "./fixtures/tarkov";

let fixtures: Record<string, unknown>;
let versions: Record<string, number>;
let failure: Response | null;
let inFlight = 0;
let peakInFlight = 0;

const catalog = () => executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular" });
const detail = () =>
  executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, { gameMode: "regular", name: "Test Rifle" });

function requests() {
  return vi.mocked(globalThis.fetch).mock.calls.map(([input, init]) => ({
    resource: new URL(String(input)).pathname.split("/").pop()!,
    headers: (init?.headers ?? {}) as Record<string, string>,
  }));
}

function requestsFor(resource: string) {
  return requests().filter((request) => request.resource === resource);
}

function memoryCache() {
  const store = new Map<string, unknown>();
  const cache: SharedCache = {
    async get(key) {
      return store.has(key) ? structuredClone(store.get(key)) : null;
    },
    async set(key, value) {
      store.set(key, structuredClone(value));
    },
  };
  return { cache, store };
}

beforeEach(() => {
  fixtures = createTarkovFixtures();
  versions = {};
  failure = null;
  inFlight = 0;
  peakInFlight = 0;
  clearTarkovResourceCache();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const resource = new URL(String(input)).pathname.split("/").pop()!;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (failure) return failure.clone();
      const fixture = fixtures[resource];
      if (!fixture) return new Response("missing fixture", { status: 404 });
      const etag = `"${resource}-${versions[resource] ?? 1}"`;
      if ((init?.headers as Record<string, string> | undefined)?.["If-None-Match"] === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: etag, "Last-Modified": "Wed, 11 Nov 2026 12:00:00 GMT" },
      });
    } finally {
      inFlight -= 1;
    }
  });
});

afterEach(() => {
  setRegionalCacheForTests();
  vi.useRealTimers();
});

describe("tarkov.dev requests", () => {
  it("identify the site with a User-Agent that has a contact URL", async () => {
    await catalog();
    for (const request of requests()) {
      expect(request.headers["User-Agent"]).toMatch(/^EFT-Toolset\/\S+ \(\+https:\/\/www\.eft-toolset\.com; https:\/\/github\.com\//);
    }
  });

  it("load each dataset once for a burst of callers, with at most four requests in flight", async () => {
    await Promise.all(Array.from({ length: 50 }, (_, index) => (index % 2 ? catalog() : detail())));
    const counts = new Map<string, number>();
    for (const request of requests()) counts.set(request.resource, (counts.get(request.resource) ?? 0) + 1);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
    expect(counts.has("items")).toBe(true);
    expect(peakInFlight).toBeLessThanOrEqual(4);
  });

  it("ask only for changes once a dataset is due, and keep the same copy when it hasn't changed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const before = await catalog();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    const after = await catalog();
    const refresh = requestsFor("items")[1];
    expect(refresh.headers["If-None-Match"]).toBe('"items-1"');
    expect(refresh.headers["If-Modified-Since"]).toBe("Wed, 11 Nov 2026 12:00:00 GMT");
    expect(after).toBe(before);
    await catalog();
    expect(requestsFor("items")).toHaveLength(2);
  });

  it("trust slow-changing datasets for longer than prices", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await detail();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await detail();
    await vi.waitFor(() => expect(requestsFor("items")).toHaveLength(2));
    expect(requestsFor("crafts")).toHaveLength(1);
    expect(requestsFor("items_en")).toHaveLength(1);
  });

  it("back off after a failure instead of retrying on every call, then try again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await catalog();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    failure = new Response("down", { status: 503 });
    await Promise.all(Array.from({ length: 20 }, () => catalog()));
    for (let call = 0; call < 20; call += 1) await catalog();
    expect(requestsFor("items")).toHaveLength(2);

    vi.setSystemTime(Date.now() + 40_000);
    failure = null;
    await catalog();
    expect(requestsFor("items")).toHaveLength(3);
  });

  it("wait as long as a 429's Retry-After asks", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await catalog();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    failure = new Response("slow down", { status: 429, headers: { "Retry-After": "900" } });
    await catalog();
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await catalog();
    expect(requestsFor("items")).toHaveLength(2);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    failure = null;
    await catalog();
    expect(requestsFor("items")).toHaveLength(3);
  });

  it("snapshot the copy a read used, not one a background refresh replaced it with", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await catalog();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    versions.items = 2;
    let snapshot: DataSnapshot = [];
    // Unloaded datasets keep the read open while items refresh.
    await executeTarkovOperation(
      TARKOV_OPERATIONS.itemDetail,
      { gameMode: "regular", name: "Test Rifle" },
      { onSnapshot: (taken) => (snapshot = taken) }
    );
    await vi.waitFor(() => expect(requestsFor("items")).toHaveLength(2));
    expect(snapshot.length).toBeGreaterThan(0);
    expect(canReuseSnapshot(snapshot)).toBe(false);
  });

  it("fail fast without a request while backing off with nothing cached", async () => {
    failure = new Response("down", { status: 500 });
    await expect(catalog()).rejects.toMatchObject({ name: "TarkovUpstreamError" });
    const made = requests().length;
    await expect(catalog()).rejects.toThrow(/retried shortly/);
    expect(requests()).toHaveLength(made);
  });
});

describe("the regional cache", () => {
  it("lets another instance reuse small datasets without asking tarkov.dev", async () => {
    const { cache, store } = memoryCache();
    setRegionalCacheForTests(cache);
    await detail();
    expect(requestsFor("crafts")).toHaveLength(1);
    expect([...store.keys()].some((key) => key.includes("/items"))).toBe(false);
    expect([...store.keys()].some((key) => key.includes("/crafts:body:"))).toBe(true);

    clearTarkovResourceCache();
    const second = (await detail()) as { name: string };
    expect(second.name).toBe("Test Rifle");
    expect(requestsFor("crafts")).toHaveLength(1);
    expect(requestsFor("barters")).toHaveLength(1);
    expect(requestsFor("items")).toHaveLength(2);
  });

  it("checks with tarkov.dev once the shared copy is due, and records the check for everyone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { cache, store } = memoryCache();
    setRegionalCacheForTests(cache);
    const checkedAt = () => (store.get("tarkov:1:regular/crafts:meta") as { checkedAt: number }).checkedAt;
    await detail();
    const firstCheck = checkedAt();
    vi.setSystemTime(Date.now() + 3 * 60 * 60_000);
    await detail();
    await vi.waitFor(() => expect(requestsFor("crafts")).toHaveLength(2));
    expect(requestsFor("crafts")[1].headers["If-None-Match"]).toBe('"crafts-1"');
    await vi.waitFor(() => expect(checkedAt()).toBeGreaterThanOrEqual(firstCheck + 3 * 60 * 60_000));
  });

  it("ignores a shared copy that fails validation", async () => {
    const { cache, store } = memoryCache();
    setRegionalCacheForTests(cache);
    await detail();
    for (const key of store.keys()) if (key.includes("/crafts:body:")) store.set(key, { data: "not crafts" });
    clearTarkovResourceCache();
    await detail();
    expect(requestsFor("crafts")).toHaveLength(2);
  });
});
