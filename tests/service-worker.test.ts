import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type FetchListener = (event: { request: Request; respondWith: (response: unknown) => void }) => void;

function loadWorker() {
  const listeners = new Map<string, FetchListener>();
  const cachesOpen = vi.fn(() => Promise.resolve(null));
  const self = {
    location: new URL("https://eft-toolset.test/"),
    addEventListener: (type: string, listener: FetchListener) => listeners.set(type, listener),
    skipWaiting: () => undefined,
    clients: { claim: () => Promise.resolve() },
  };
  runInNewContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), {
    self,
    caches: { open: cachesOpen, keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) },
    fetch: () => Promise.reject(new Error("no network in tests")),
    URL,
    Response,
    setTimeout,
    clearTimeout,
  });
  return { fetch: listeners.get("fetch")!, cachesOpen };
}

describe("service worker", () => {
  it("leaves cross-origin requests, such as wiki images, to the browser", () => {
    const { fetch, cachesOpen } = loadWorker();
    const respondWith = vi.fn();
    fetch({ request: new Request("https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/4/4a/A.png"), respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(cachesOpen).not.toHaveBeenCalled();
  });

  it("still handles its own static files", () => {
    const { fetch } = loadWorker();
    const respondWith = vi.fn((response: unknown) => void Promise.resolve(response).catch(() => undefined));
    fetch({ request: new Request("https://eft-toolset.test/_next/static/chunk.js"), respondWith });
    expect(respondWith).toHaveBeenCalledOnce();
  });
});
