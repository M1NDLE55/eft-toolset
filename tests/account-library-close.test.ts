import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountLibrary } from "@/app/lib/account-sync/account-library";

// A tab that thinks it is signed in opens its account cache at once, then the account check finds the
// session over and closes it. That can land at any step of opening.

afterEach(() => {
  vi.restoreAllMocks();
});

async function openThenClose(steps: number) {
  const library = new AccountLibrary(`close-${steps}-${Math.random().toString(36).slice(2)}`);
  const addListener = vi.spyOn(window, "addEventListener");
  const opening = library.open();
  for (let step = 0; step < steps; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  library.close();
  return { library, opening, addListener };
}

describe("an account library closed while it opens", () => {
  for (const steps of [0, 1, 2, 3, 5, 8]) {
    it(`stops quietly when closed after ${steps} step(s)`, async () => {
      const { library, opening, addListener } = await openThenClose(steps);
      await expect(opening).resolves.toBeUndefined();
      // Closed before it was ready: nothing left behind for a library no one holds. (Closed after,
      // close() removed them.) Either way, no error escapes: the test fails on an unhandled one.
      if (!library.ready) expect(addListener.mock.calls.map(([type]) => String(type)).filter((type) => type === "online" || type === "offline")).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  it("leaves no connection open, so the database can be opened again at a newer version", async () => {
    const cacheKey = `reopen-${Math.random().toString(36).slice(2)}`;
    const library = new AccountLibrary(cacheKey);
    const opening = library.open();
    library.close();
    await opening;
    // A connection left open would block this upgrade (onblocked) and never resolve.
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`eft-toolset-account-${cacheKey}`, 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("blocked by a connection left open"));
    });
    expect(upgraded.version).toBe(2);
    upgraded.close();
  });

  it("still opens normally when not closed", async () => {
    const library = new AccountLibrary(`normal-${Math.random().toString(36).slice(2)}`);
    await library.open();
    expect(library.ready).toBe(true);
    library.close();
  });
});
