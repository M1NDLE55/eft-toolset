// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderDataUnavailableError } from "@/app/lib/render-errors";

const executeTarkovOperation = vi.fn();
const getItemPageIndex = vi.fn();
const waitForRenderSlot = vi.fn();
const runTarkovRead = vi.fn((work: () => unknown, _options?: unknown) => work());

vi.mock("@/app/lib/api/tarkov-server", () => ({
  executeTarkovOperation: (...args: unknown[]) => executeTarkovOperation(...args),
  getItemPageIndex: (...args: unknown[]) => getItemPageIndex(...args),
  waitForRenderSlot: (...args: unknown[]) => waitForRenderSlot(...args),
  releaseRenderSlot: () => undefined,
  runTarkovRead: (work: () => unknown, options: unknown) => runTarkovRead(work, options),
}));

const { ITEM_RENDER_STALE_WAIT_MS, loadItem, loadItemIndexing } = await import("@/app/item/detail/item-route");
const { loadItemPage } = await import("@/app/item/detail/item-page.server");

/** Settles only when the caller's signal aborts, as a stuck upstream request does. */
function untilAborted(_operation: unknown, _variables: unknown, { signal }: { signal: AbortSignal }) {
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
}

describe("item page timeouts", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    waitForRenderSlot.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    executeTarkovOperation.mockReset();
    getItemPageIndex.mockReset();
    waitForRenderSlot.mockReset();
  });

  it("fails the render when the item doesn't arrive in time, and logs the page and the step", async () => {
    // The render's deadline (AbortSignal.timeout), ended by hand rather than waited out.
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    executeTarkovOperation.mockImplementation(untilAborted);

    const page = loadItemPage("regular", "shutter-glasses-red");
    const outcome = expect(page).rejects.toBeInstanceOf(RenderDataUnavailableError);
    await vi.waitFor(() => expect(executeTarkovOperation).toHaveBeenCalled());
    deadline.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    await outcome;
    expect(warn).toHaveBeenCalledWith("Item page timed out", { page: "/item/shutter-glasses-red", step: "item", ms: expect.any(Number) });
  });

  it("names the render slot when the server was too busy to start", async () => {
    waitForRenderSlot.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    await expect(loadItem("labyrinth-key", "regular")).resolves.toEqual({ item: undefined });
    expect(executeTarkovOperation).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Item page timed out", { page: "/item/labyrinth-key", step: "render slot", ms: expect.any(Number) });
  });

  it("tells a failed request from a timeout", async () => {
    executeTarkovOperation.mockRejectedValue(new Error("tarkov.dev answered 502"));
    await expect(loadItem("labyrinth-key", "regular")).resolves.toEqual({ item: undefined });
    expect(warn).toHaveBeenCalledWith("Item page data failed", { page: "/item/labyrinth-key", step: "item", ms: expect.any(Number), error: "tarkov.dev answered 502" });
  });

  it("logs the index step when the item index isn't ready in time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    getItemPageIndex.mockReturnValue(new Promise(() => undefined));
    const indexing = loadItemIndexing("mxlr-hammer");
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(indexing).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Item page timed out", { page: "/item/mxlr-hammer", step: "item index", ms: expect.any(Number) });
  });

  it("waits only briefly for a slow refresh, and renders from the copies it has, marked stale", async () => {
    const ITEM = { id: "5c1d0d6d86f7744bb2683e1f", name: "Factory emergency exit key", normalizedName: "factory-emergency-exit-key" };
    const hour = 60 * 60_000;
    executeTarkovOperation.mockImplementation((_operation, _variables, options: { staleWaitMs?: number; onStale?: () => void; onDataAge?: (ms: number) => void }) => {
      // The adapter took a copy whose refresh didn't finish in time.
      options.onStale?.();
      options.onDataAge?.(4.5 * hour);
      return Promise.resolve(ITEM);
    });
    const before = Date.now();
    const load = await loadItem("factory-emergency-exit-key", "regular");
    expect(executeTarkovOperation).toHaveBeenCalledWith(
      "item.detail",
      { gameMode: "regular", slug: "factory-emergency-exit-key" },
      expect.objectContaining({ staleWaitMs: ITEM_RENDER_STALE_WAIT_MS })
    );
    expect(load.item).toBe(ITEM);
    // Dated by its oldest copy, so the browser sees its age and loads the item afresh.
    expect(load.staleSince).toBeGreaterThanOrEqual(before - 4.5 * hour);
    expect(load.staleSince).toBeLessThanOrEqual(Date.now() - 4.5 * hour);
    expect(warn).toHaveBeenCalledWith("Item page slow or stale", expect.objectContaining({ page: "/item/factory-emergency-exit-key", stale: true, dataAgeMinutes: 270 }));
  });

  it("marks a current read as such, and logs nothing for it", async () => {
    executeTarkovOperation.mockResolvedValue({ id: "x", name: "Key", normalizedName: "key" });
    await expect(loadItem("key", "regular")).resolves.toEqual({ item: { id: "x", name: "Key", normalizedName: "key" } });
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads the item index with the same short wait for a slow refresh", async () => {
    getItemPageIndex.mockResolvedValue({ pages: new Map([["mxlr-hammer", { indexing: { kind: "index" } }]]), publishedAt: null });
    await expect(loadItemIndexing("mxlr-hammer")).resolves.toEqual({ kind: "index" });
    expect(runTarkovRead).toHaveBeenCalledWith(expect.any(Function), { staleWaitMs: ITEM_RENDER_STALE_WAIT_MS });
  });

  it("logs nothing when the index simply has no entry for the page", async () => {
    getItemPageIndex.mockResolvedValue({ pages: new Map(), publishedAt: null });
    await expect(loadItemIndexing("mxlr-hammer")).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
