import { describe, expect, it, vi } from "vitest";

const stored = new Map<string, unknown>();
let releaseRead: (() => void) | undefined;

vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  getMany: (keys: string[]) =>
    new Promise((resolve) => {
      releaseRead = () => resolve(keys.map((key) => stored.get(key)));
    }),
  setMany: async (entries: [string, unknown][]) => {
    for (const [key, value] of entries) stored.set(key, value);
  },
}));

describe("price history loading", () => {
  it("waits for an in-flight history read before recording a new price", async () => {
    stored.set("regular:Salewa", [{ t: 0, p: 100 }]);
    const { recordPrices, usePriceHistories } = await import("@/app/lib/price-history");
    const { renderHook } = await import("./render-hook");
    renderHook(() => usePriceHistories("regular", ["Salewa"]));
    const recording = recordPrices("regular", [{ name: "Salewa", price: 200 }]);
    releaseRead?.();
    await recording;
    expect(stored.get("regular:Salewa")).toEqual([
      { t: 0, p: 100 },
      expect.objectContaining({ p: 200 }),
    ]);
  });
});
