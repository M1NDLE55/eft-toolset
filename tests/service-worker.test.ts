import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    fetch({ request: new Request("https://eft-toolset.test/assets/chunk-a1b2c3.js"), respondWith });
    expect(respondWith).toHaveBeenCalledOnce();
  });
});

type Listener = (event: { request?: Request; respondWith?: (response: Promise<Response>) => void; waitUntil?: (promise: Promise<unknown>) => void }) => void;

/** The worker with a working Cache Storage and a network that answers as `network` says. */
function loadWorkerWithCaches(network: (request: Request) => Promise<Response>, build = "index-BBBBbbbb") {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, Response>>();
  const open = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      match: (request: Request) => Promise.resolve(store.get(request.url)?.clone()),
      put: (request: Request, response: Response) => Promise.resolve(void store.set(request.url, response)),
      keys: () => Promise.resolve([...store.keys()].map((url) => new Request(url))),
      delete: (request: Request) => Promise.resolve(store.delete(request.url)),
    };
  };
  const self = {
    location: new URL("https://eft-toolset.test/"),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: () => undefined,
    clients: { claim: () => Promise.resolve() },
  };
  const source = readFileSync(join(process.cwd(), "public/sw.js"), "utf8").replace("__EFT_BUILD__", build);
  runInNewContext(source, {
    self,
    caches: {
      open: (name: string) => Promise.resolve(open(name)),
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (name: string) => Promise.resolve(stores.delete(name)),
    },
    fetch: network,
    URL,
    Response,
    setTimeout,
    clearTimeout,
  });
  const navigate = (path: string) => {
    let answer: Promise<Response> | undefined;
    const request = new Request(`https://eft-toolset.test${path}`);
    Object.defineProperty(request, "mode", { value: "navigate" });
    listeners.get("fetch")!({ request, respondWith: (response) => void (answer = response) });
    return answer!;
  };
  const activate = async () => {
    let done: Promise<unknown> | undefined;
    listeners.get("activate")!({ waitUntil: (promise) => void (done = promise) });
    await done;
  };
  return { navigate, activate, stores };
}

const page = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/html", Date: new Date().toUTCString() } });
// Response.type is "default" outside a browser; the worker keeps only same-origin ("basic") answers.
const basic = (response: Response) => Object.defineProperty(response, "type", { value: "basic" });

describe("service worker pages", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for a slow page it hasn't kept, instead of saying it's offline", async () => {
    vi.useFakeTimers();
    const { navigate } = loadWorkerWithCaches(() => new Promise((resolve) => setTimeout(() => resolve(basic(page("current page"))), 9000)));
    const answer = navigate("/ammo");
    await vi.advanceTimersByTimeAsync(9000);
    const response = await answer;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("current page");
  });

  it("answers from its kept copy of this build's page when the network is slow", async () => {
    vi.useFakeTimers();
    let slow = false;
    const { navigate } = loadWorkerWithCaches(() =>
      slow ? new Promise(() => undefined) : Promise.resolve(basic(page("kept page")))
    );
    expect(await (await navigate("/ammo")).text()).toBe("kept page");
    slow = true;
    const answer = navigate("/ammo");
    await vi.advanceTimersByTimeAsync(4000);
    expect(await (await answer).text()).toBe("kept page");
  });

  it("still shows the offline page when the network fails and nothing is kept", async () => {
    const { navigate } = loadWorkerWithCaches(() => Promise.reject(new TypeError("Failed to fetch")));
    const response = await navigate("/ammo");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Offline");
  });

  it("keeps pages per build, and drops an earlier build's pages when it takes over", async () => {
    const network = () => Promise.resolve(basic(page("build A page")));
    const older = loadWorkerWithCaches(network, "index-AAAAaaaa");
    await older.navigate("/ammo");
    expect([...older.stores.keys()]).toEqual(["eft-pages-v4-index-AAAAaaaa"]);

    // The next deploy's worker shares the same Cache Storage.
    const newer = loadWorkerWithCaches(network, "index-BBBBbbbb");
    for (const [name, store] of older.stores) newer.stores.set(name, store);
    newer.stores.set("eft-pages-v4", new Map());
    newer.stores.set("eft-static-v4", new Map());
    await newer.activate();
    expect([...newer.stores.keys()]).toEqual(["eft-static-v4"]);
  });
});
