// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderDataUnavailableError } from "@/app/lib/render-errors";

const executeTarkovOperation = vi.fn();
const getItemPageIndex = vi.fn();
const waitForRenderSlot = vi.fn();

vi.mock("@/app/lib/api/tarkov-server", () => ({
  executeTarkovOperation: (...args: unknown[]) => executeTarkovOperation(...args),
  getItemPageIndex: (...args: unknown[]) => getItemPageIndex(...args),
  waitForRenderSlot: (...args: unknown[]) => waitForRenderSlot(...args),
  releaseRenderSlot: () => undefined,
  runTarkovRead: () => undefined,
}));

const { loadItem, loadItemIndexing } = await import("@/app/item/detail/item-route");
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
    expect(warn).toHaveBeenCalledWith("Item page timed out", { page: "/item/shutter-glasses-red", step: "item" });
  });

  it("names the render slot when the server was too busy to start", async () => {
    waitForRenderSlot.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    await expect(loadItem("labyrinth-key", "regular")).resolves.toBeUndefined();
    expect(executeTarkovOperation).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Item page timed out", { page: "/item/labyrinth-key", step: "render slot" });
  });

  it("tells a failed request from a timeout", async () => {
    executeTarkovOperation.mockRejectedValue(new Error("tarkov.dev answered 502"));
    await expect(loadItem("labyrinth-key", "regular")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Item page data failed", { page: "/item/labyrinth-key", step: "item", error: "tarkov.dev answered 502" });
  });

  it("logs the index step when the item index isn't ready in time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    getItemPageIndex.mockReturnValue(new Promise(() => undefined));
    const indexing = loadItemIndexing("mxlr-hammer");
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(indexing).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Item page timed out", { page: "/item/mxlr-hammer", step: "item index" });
  });

  it("logs nothing when the index simply has no entry for the page", async () => {
    getItemPageIndex.mockResolvedValue({ pages: new Map(), publishedAt: null });
    await expect(loadItemIndexing("mxlr-hammer")).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
