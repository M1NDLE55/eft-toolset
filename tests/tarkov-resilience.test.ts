import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import {
  clearTarkovResourceCache,
  executeTarkovOperation,
  getItemCatalog,
  MCP_STALE_WAIT_MS,
  runTarkovRead,
  settleTarkovRefreshes,
  tarkovDataStatus,
  TarkovUpstreamError,
  type TarkovReadOptions,
} from "@/app/lib/api/tarkov-server";
import { readSnapshot, setTarkovSnapshotDirForTests } from "@/app/lib/api/tarkov-snapshot";
import { createTarkovFixtures } from "./fixtures/tarkov";
import { SNAPSHOT_RESOURCES, writeTarkovSnapshot } from "./fixtures/tarkov-snapshot";

// How the adapter behaves when tarkov.dev is down, slow, or flaky: it serves the newest copy it has
// (from memory or the deployment's snapshot) and says so, and only fails when it has no copy at all.

const RESOURCES = SNAPSHOT_RESOURCES;

type Mode = "up" | "down" | "hang" | "slow";

let fixtures: Record<string, unknown>;
let mode: Mode;
/** Status codes to answer the next requests with, before `mode` applies. */
let queued: number[];
let snapshotDir: string | null;
/** Fails the requests left hanging, so no refresh outlives its test. */
let hanging: Array<() => void>;

const catalog = (options?: TarkovReadOptions) =>
  executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular" }, options);
const detail = (options?: TarkovReadOptions) =>
  executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, { gameMode: "regular", name: "Test Rifle" }, options);

function requests() {
  return vi.mocked(globalThis.fetch).mock.calls.map(([input, init]) => ({
    resource: new URL(String(input)).pathname.split("/").pop()!,
    headers: (init?.headers ?? {}) as Record<string, string>,
  }));
}

const requestsFor = (resource: string) => requests().filter((request) => request.resource === resource);

async function writeSnapshot(ageMs: number) {
  snapshotDir = await writeTarkovSnapshot(fixtures, ageMs);
}

beforeEach(() => {
  fixtures = createTarkovFixtures();
  mode = "up";
  queued = [];
  hanging = [];
  snapshotDir = null;
  clearTarkovResourceCache();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const resource = new URL(String(input)).pathname.split("/").pop()!;
    await new Promise((resolve) => setTimeout(resolve, 1));
    const status = queued.shift();
    if (status) return new Response("upstream error", { status });
    if (mode === "down") return new Response("bad gateway", { status: 502 });
    if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 3_500));
    if (mode === "hang") {
      return new Promise<Response>((_, reject) => {
        const fail = () => reject(new DOMException("aborted", "AbortError"));
        init?.signal?.addEventListener("abort", fail);
        hanging.push(fail);
      });
    }
    const etag = `"${resource}-1"`;
    if ((init?.headers as Record<string, string> | undefined)?.["If-None-Match"] === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    return new Response(JSON.stringify(fixtures[resource]), { status: 200, headers: { ETag: etag } });
  });
});

afterEach(async () => {
  vi.useRealTimers();
  // Let refreshes left running finish before the next test clears the cache.
  mode = "up";
  for (const fail of hanging.splice(0)) fail();
  await settleTarkovRefreshes();
  setTarkovSnapshotDirForTests(null);
  if (snapshotDir) await rm(snapshotDir, { recursive: true, force: true });
});

describe("a cold instance with tarkov.dev down", () => {
  it("answers from the deployment's snapshot and says so", async () => {
    await writeSnapshot(3 * 60 * 60_000);
    mode = "down";
    const onStale = vi.fn();
    const onDataAge = vi.fn();
    const started = performance.now();
    await expect(detail({ onStale, onDataAge, maxStaleMs: Infinity })).resolves.toMatchObject({ name: "Test Rifle" });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(onStale).toHaveBeenCalledWith({ source: "deployment" });
    expect(onDataAge.mock.calls[0][0]).toBeGreaterThanOrEqual(3 * 60 * 60_000);
  });

  it("answers from a snapshot older than the default stale limit only for reads that accept it", async () => {
    await writeSnapshot(2 * 24 * 60 * 60_000);
    mode = "down";
    // Cached pages keep the six-hour limit, so a failed render keeps the previous page.
    await expect(catalog()).rejects.toMatchObject({ name: "TarkovUpstreamError" });
    await expect(catalog({ maxStaleMs: Infinity })).resolves.toContainEqual(
      ["weapon", "Test Rifle", "Rifle", "weapon.webp", "test-rifle"]
    );
  });

  it("returns a retryable error with retryAfter only when it has no copy, and recovers within seconds", async () => {
    mode = "down";
    const error = await catalog().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "TarkovUpstreamError" });
    const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs!;
    expect(retryAfterMs).toBeGreaterThan(0);
    // The longest wait among the datasets the call needed, so retrying then finds them all ready.
    expect(retryAfterMs).toBeLessThanOrEqual(15_000);
    // The first request and two quick retries, not one request per caller. The call fails as soon as
    // one dataset gives up, so let the others finish first.
    await settleTarkovRefreshes();
    expect(requestsFor("items")).toHaveLength(3);

    // Not the old 30-second lockout: once retryAfter has passed, the next call asks again and succeeds.
    mode = "up";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + retryAfterMs + 1);
    await expect(catalog()).resolves.toContainEqual(["weapon", "Test Rifle", "Rifle", "weapon.webp", "test-rifle"]);
  });

  it("rides out a single failed request without the caller noticing", async () => {
    queued = [502];
    const onStale = vi.fn();
    await expect(catalog({ onStale })).resolves.toContainEqual(["weapon", "Test Rifle", "Rifle", "weapon.webp", "test-rifle"]);
    expect(onStale).not.toHaveBeenCalled();
    expect(requestsFor("items")).toHaveLength(2);
  });

  it("doesn't wait out a long Retry-After within a call", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("slow down", { status: 429, headers: { "Retry-After": "120" } }));
    const error = await catalog().catch((caught: unknown) => caught);
    expect(requestsFor("items")).toHaveLength(1);
    expect((error as { retryAfterMs?: number }).retryAfterMs).toBeGreaterThan(100_000);
  });
});

describe("upstream errors", () => {
  it("are recognised from any bundled copy of the adapter, so they aren't reported as crashes", () => {
    // What another server chunk's copy of the class throws: same name, different constructor.
    class TarkovUpstreamErrorFromAnotherChunk extends Error {
      name = "TarkovUpstreamError";
    }
    expect(new TarkovUpstreamErrorFromAnotherChunk("timed out")).toBeInstanceOf(TarkovUpstreamError);
    expect(new Error("timed out")).not.toBeInstanceOf(TarkovUpstreamError);
  });

  it("come from requests that ask for brotli", async () => {
    await catalog();
    expect(requestsFor("items")[0].headers["Accept-Encoding"]).toBe("br, gzip");
  });
});

describe("the deployment's snapshot", () => {
  it("answers without any request while it is fresh", async () => {
    await writeSnapshot(60_000);
    await expect(detail()).resolves.toMatchObject({ name: "Test Rifle" });
    expect(requests()).toHaveLength(0);
  });

  it("is revalidated with its ETag, so an unchanged dataset costs a 304", async () => {
    await writeSnapshot(3 * 60 * 60_000);
    await catalog();
    expect(requestsFor("items")).toHaveLength(1);
    expect(requestsFor("items")[0].headers["If-None-Match"]).toBe('"items-1"');
    const items = tarkovDataStatus(["regular"]).find((status) => status.dataset === "items")!;
    expect(items).toMatchObject({ source: "tarkov.dev", state: "fresh", loaded: true });
  });

  it("round-trips through the reader", async () => {
    await writeSnapshot(0);
    await expect(readSnapshot("regular", "traders")).resolves.toMatchObject({ value: fixtures.traders, etag: '"traders-1"' });
    await expect(readSnapshot("pve", "traders")).resolves.toBeNull();
  });
});

describe("refreshes", () => {
  it("share one request per dataset among a burst of cold callers", async () => {
    await Promise.all(Array.from({ length: 50 }, () => detail()));
    for (const resource of ["items", "items_en", "tasks", "traders", "barters", "crafts", "hideout"]) {
      expect(requestsFor(resource)).toHaveLength(1);
    }
  });

  it("don't hold a caller with a copy for longer than a moment when tarkov.dev is slow", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await catalog();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    mode = "hang";
    const onStale = vi.fn();
    const started = performance.now();
    await expect(catalog({ onStale, staleWaitMs: MCP_STALE_WAIT_MS })).resolves.toContainEqual(
      ["weapon", "Test Rifle", "Rifle", "weapon.webp", "test-rifle"]
    );
    const waited = performance.now() - started;
    expect(waited).toBeGreaterThanOrEqual(MCP_STALE_WAIT_MS - 50);
    expect(waited).toBeLessThan(MCP_STALE_WAIT_MS + 2_500);
    expect(onStale).toHaveBeenCalledWith({ source: "tarkov.dev" });
    expect(tarkovDataStatus(["regular"]).find((status) => status.dataset === "items")!.state).toBe("refreshing");

    // The refresh is known to be slow now, so the next caller takes the copy without waiting again.
    const next = performance.now();
    await catalog({ staleWaitMs: MCP_STALE_WAIT_MS });
    expect(performance.now() - next).toBeLessThan(200);
  });

  it("let page renders wait out a slow refresh, so they don't cache an older copy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await catalog();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    mode = "slow";
    const onStale = vi.fn();
    await catalog({ onStale });
    expect(onStale).not.toHaveBeenCalled();
    expect(tarkovDataStatus(["regular"]).find((status) => status.dataset === "items")).toMatchObject({ state: "fresh", ageSeconds: 0 });
  }, 10_000);

  it("date a result by the copy it used, even when a refresh lands during the read", async () => {
    await writeSnapshot(3 * 60 * 60_000);
    mode = "slow";
    const onStale = vi.fn();
    const onDataAge = vi.fn();
    await runTarkovRead(
      async () => {
        await getItemCatalog("regular");
        // The refresh lands while the read is still working.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      },
      { onStale, onDataAge, maxStaleMs: Infinity, staleWaitMs: MCP_STALE_WAIT_MS }
    );
    expect(tarkovDataStatus(["regular"]).find((status) => status.dataset === "items")!.source).toBe("tarkov.dev");
    expect(onStale).toHaveBeenCalledWith({ source: "deployment" });
    expect(onDataAge.mock.calls[0][0]).toBeGreaterThanOrEqual(3 * 60 * 60_000);
  }, 10_000);

  it("don't make callers with a copy wait at all while tarkov.dev is failing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await catalog();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    mode = "down";
    await catalog();
    const failing = tarkovDataStatus(["regular"]).find((status) => status.dataset === "items")!;
    expect(failing).toMatchObject({ state: "failing", lastError: expect.stringMatching(/502/) });
    expect(failing.retryAfterSeconds).toBeGreaterThan(0);
    const made = requests().length;
    const started = performance.now();
    const onStale = vi.fn();
    await catalog({ onStale });
    expect(performance.now() - started).toBeLessThan(100);
    expect(onStale).toHaveBeenCalledOnce();
    expect(requests()).toHaveLength(made);
  });

  it("report every dataset's state without loading anything", () => {
    const statuses = tarkovDataStatus();
    expect(statuses).toHaveLength(2 * RESOURCES.length);
    expect(statuses.every((status) => status.state === "not loaded")).toBe(true);
    expect(requests()).toHaveLength(0);
  });
});

describe("the snapshot build script", () => {
  let server: Server | undefined;
  let out: string | undefined;

  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    if (out) await rm(out, { recursive: true, force: true });
    delete process.env.TARKOV_UPSTREAM_URL;
    vi.resetModules();
  });

  it("writes every dataset compressed, within the size budget, and keeps going past failures", async () => {
    vi.mocked(globalThis.fetch).mockRestore();
    server = createServer((request, response) => {
      const [, gameMode, resource] = request.url!.split("/");
      if (gameMode === "pve" && resource === "maps") {
        response.writeHead(503).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json", ETag: `"${resource}"` }).end(JSON.stringify(fixtures[resource]));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    process.env.TARKOV_UPSTREAM_URL = `http://127.0.0.1:${port}`;
    out = await mkdtemp(join(tmpdir(), "tarkov-snapshot-build-"));
    const { buildSnapshot } = await import("../scripts/build-tarkov-snapshot.mjs");
    const quiet = { info: () => undefined, warn: () => undefined };
    const manifest = await buildSnapshot(out, quiet);
    // Every dataset but the failed one, and an item index per mode.
    expect(Object.keys(manifest.resources)).toHaveLength(2 * RESOURCES.length - 1 + 2);
    expect(manifest.resources["pve/maps"]).toBeUndefined();
    expect(manifest.resources["regular/items"]).toMatchObject({ etag: '"items"', fetchedAt: expect.any(Number) });
    expect(manifest.resources["regular/item-index"]).toMatchObject({
      fetchedAt: manifest.resources["regular/items"].fetchedAt,
      items: { etag: '"items"' },
      items_en: { etag: '"items_en"' },
    });

    setTarkovSnapshotDirForTests(out);
    await expect(readSnapshot("regular", "items")).resolves.toMatchObject({ value: fixtures.items });
  }, 20_000);
});

describe("the real snapshot, when a build has written one", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const manifestPath = join(process.cwd(), "data", "tarkov", "manifest.json");
  it.skipIf(!existsSync(manifestPath))("stays small enough to bundle with every function", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      resources: Record<string, { compressedBytes: number }>;
    };
    const sizes = Object.values(manifest.resources).map((entry) => entry.compressedBytes);
    // Today about 4 MB in all and under 1 MB for the largest (items); twice that means something changed.
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(8 * 1024 * 1024);
    expect(Math.max(...sizes)).toBeLessThan(2 * 1024 * 1024);
  });
});
