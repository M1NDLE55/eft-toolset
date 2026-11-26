import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook as render } from "./render-hook";
import { parsePriceUpdate, type PriceUpdate } from "@/app/lib/prices/live-protocol";

// Live prices in the browser: one socket per game mode, a refetch when the refresher's version is
// newer than the page's, the header's "Updating prices" notice, and nothing at all when the socket
// can't be had.

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(update: Partial<PriceUpdate>) {
    const message: PriceUpdate = { type: "prices", version: 1, publishedAt: null, confirmedAt: null, checking: false, stale: false, ...update };
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

let live: typeof import("@/app/lib/prices/live-prices");
let mounted: { unmount: () => void }[] = [];

/** Renders the hook, unmounted after the test (each test's module copy listens on the same document). */
function renderHook(hook: () => unknown) {
  const handle = render(hook);
  let done = false;
  const unmount = () => {
    if (done) return;
    done = true;
    handle.unmount();
  };
  mounted.push({ unmount });
  return { unmount };
}

beforeEach(async () => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // The module keeps its sockets and listeners for the page's life: a fresh copy for each test.
  vi.resetModules();
  live = await import("@/app/lib/prices/live-prices");
});

afterEach(() => {
  for (const handle of mounted) handle.unmount();
  mounted = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live prices", () => {
  it("open one socket per game mode however many parts of the page follow it, and close it when none do", () => {
    const first = renderHook(() => live.useLivePrices("regular", 1, async () => undefined));
    const second = renderHook(() => live.useLivePrices("regular", 1, async () => undefined));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe("ws://localhost:3000/api/prices/live?mode=regular");
    first.unmount();
    expect(FakeWebSocket.instances[0].readyState).toBe(0);
    second.unmount();
    expect(FakeWebSocket.instances[0].readyState).toBe(3);
  });

  it("refetch once when the refresher's version is newer than the page's, and not for the one it has", () => {
    const update = vi.fn(async () => undefined);
    renderHook(() => live.useLivePrices("regular", 5, update));
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.push({ version: 5 });
    expect(update).not.toHaveBeenCalled();
    socket.push({ version: 6, checking: false });
    socket.push({ version: 6, checking: false });
    expect(update.mock.calls).toEqual([[6]]);
    expect(live.wantedPricesVersion("regular")).toBe(6);
  });

  it("do nothing for prices that didn't come from the feed", () => {
    const update = vi.fn(async () => undefined);
    renderHook(() => live.useLivePrices("regular", null, update));
    FakeWebSocket.instances[0].push({ version: 9 });
    expect(update).not.toHaveBeenCalled();
  });

  it("show 'Updating prices' while the refetch runs, and for a check only once it has run a while", async () => {
    let finish!: () => void;
    renderHook(() => live.useLivePrices("regular", 1, () => new Promise<void>((resolve) => (finish = resolve))));
    const socket = FakeWebSocket.instances[0];
    socket.open();

    // A quick 304: never shown.
    socket.push({ version: 1, checking: true });
    vi.advanceTimersByTime(200);
    socket.push({ version: 1, checking: false });
    vi.advanceTimersByTime(2_000);
    expect(live.isUpdatingPrices()).toBe(false);

    // A check that brings new prices: shown after a moment, until the page has refetched.
    socket.push({ version: 1, checking: true });
    vi.advanceTimersByTime(700);
    expect(live.isUpdatingPrices()).toBe(true);
    socket.push({ version: 2, checking: false });
    expect(live.isUpdatingPrices()).toBe(true);
    await act(async () => finish());
    vi.advanceTimersByTime(1_000);
    expect(live.isUpdatingPrices()).toBe(false);
  });

  it("reconnect with a backoff when the socket drops, and get the current version again", () => {
    const update = vi.fn(async () => undefined);
    renderHook(() => live.useLivePrices("regular", 3, update));
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].drop();
    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].open();
    FakeWebSocket.instances[1].push({ version: 4 });
    expect(update.mock.calls).toEqual([[4]]);
  });

  it("close a hidden tab's socket after a minute and reconnect when it's shown", () => {
    renderHook(() => live.useLivePrices("regular", 1, async () => undefined));
    FakeWebSocket.instances[0].open();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(61_000);
    expect(FakeWebSocket.instances[0].readyState).toBe(3);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("keep the page as it is without WebSocket", () => {
    vi.stubGlobal("WebSocket", undefined);
    const update = vi.fn(async () => undefined);
    expect(() => renderHook(() => live.useLivePrices("regular", 1, update))).not.toThrow();
    expect(live.wantedPricesVersion("regular")).toBeUndefined();
  });
});

describe("parsePriceUpdate", () => {
  it("reads the refresher's message and refuses anything else", () => {
    expect(parsePriceUpdate(JSON.stringify({ type: "prices", version: 3, publishedAt: null, confirmedAt: null, checking: true, stale: false }))).toMatchObject({ version: 3, checking: true });
    expect(parsePriceUpdate("pong")).toBeNull();
    expect(parsePriceUpdate(JSON.stringify({ type: "prices", version: -1, publishedAt: null, confirmedAt: null, checking: false, stale: false }))).toBeNull();
    expect(parsePriceUpdate(JSON.stringify({ type: "other" }))).toBeNull();
    expect(parsePriceUpdate("x".repeat(3_000))).toBeNull();
  });
});
