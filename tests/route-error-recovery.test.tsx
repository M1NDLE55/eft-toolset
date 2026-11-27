import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  RouterProvider,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposedItem } from "@/app/lib/cache/types";
import { RenderDataUnavailableError } from "@/app/lib/render-errors";

const beacons: Array<{ event: string; route?: string; errorKind?: string }> = [];
vi.mock("@/app/lib/usage/track", () => ({
  trackUsage: (event: string, fields: Record<string, string> = {}) => void beacons.push({ event, ...fields }),
}));
const apiFetch = vi.fn();
vi.mock("@/app/lib/api/transport", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
// No IndexedDB in jsdom: the query cache keeps entries in memory only.
vi.mock("@/app/lib/cache/store", () => {
  const none = () => Promise.resolve(undefined);
  return { cacheGet: none, cacheSet: none, cacheGetMany: () => Promise.resolve([]), cacheSetMany: none, cacheDelete: none, cacheDeleteMany: none, cacheKeys: () => Promise.resolve([]), cacheClear: none };
});
vi.mock("@/app/lib/navigation/image", () => ({ default: () => null }));
vi.mock("@/app/lib/navigation/link", () => ({
  default: ({ href, prefetch: _prefetch, children, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a {...props} href={String(href)}>
      {children}
    </a>
  ),
}));

const { RouteErrorPage, resetReportedPageErrors } = await import("@/app/components/global/route-status");
const { browserOnly } = await import("@/app/components/raid-planner/lazy-canvas");
const { handOverChunkErrors, resetStaleBuildReloads } = await import("@/app/lib/stale-build");
const { Route: ItemRoute } = await import("@/routes/item/$itemName");
const { GameModeProvider } = await import("@/components/game-mode/context");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  beacons.length = 0;
  resetReportedPageErrors();
  sessionStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  apiFetch.mockReset();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** One page at `path`, loaded by `loader`, inside a real router; the app's error page unless given another. */
async function renderPage(
  path: string,
  loader: () => unknown,
  errorComponent?: (props: ErrorComponentProps) => React.ReactNode,
  component: () => React.ReactNode = () => <p>Page loaded</p>
) {
  const rootRoute = createRootRoute({ component: Outlet });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "/page/$name",
    loader,
    component,
    ...(errorComponent ? { errorComponent } : {}),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultErrorComponent: RouteErrorPage,
  });
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  return router;
}

const text = () => host.textContent ?? "";
const errorKinds = () => beacons.filter((beacon) => beacon.event === "page.error").map((beacon) => beacon.errorKind);

describe("a page that fails to load", () => {
  it("loads again by itself once when its data wasn't ready in time", async () => {
    const loader = vi.fn().mockRejectedValueOnce(new RenderDataUnavailableError("Test page")).mockResolvedValue(null);
    await renderPage("/page/slow-data", loader);
    expect(text()).toContain("Page loaded");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(errorKinds()).toEqual(["unavailable"]);
  });

  it("shows the error after a second failure, and Try Again still loads it", async () => {
    const loader = vi.fn((): Promise<null> => Promise.reject(new RenderDataUnavailableError("Test page")));
    await renderPage("/page/still-slow", loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Something went wrong");
    // One failure of the page, recorded once though it showed twice.
    expect(errorKinds()).toEqual(["unavailable"]);

    loader.mockImplementation(() => Promise.resolve(null));
    await act(async () => host.querySelector("button")!.click());
    await settle();
    expect(text()).toContain("Page loaded");
  });

  it("ends on the error page even when a loader throws the same error object again", async () => {
    const loader = vi.fn().mockRejectedValue(new RenderDataUnavailableError("Test page"));
    await renderPage("/page/same-error", loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Something went wrong");
  });

  it("retries a request that got no answer", async () => {
    const loader = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(null);
    await renderPage("/page/offline-blip", loader);
    expect(text()).toContain("Page loaded");
    expect(errorKinds()).toEqual(["network"]);
  });

  it("shows a bug's error at once, without retrying", async () => {
    const loader = vi.fn().mockRejectedValue(new TypeError("e.buyFor.filter(...).toSorted is not a function"));
    await renderPage("/page/broken", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Something went wrong");
    expect(errorKinds()).toEqual(["crash"]);
  });

  it("reloads the page once when a code chunk didn't download, and not again", async () => {
    const chunkError = () => new TypeError("Failed to fetch dynamically imported module: https://www.eft-toolset.com/assets/map-canvas-CmQ9CYMk.js");
    const loader = vi.fn().mockRejectedValue(chunkError());
    await renderPage("/page/missing-chunk", loader);
    // jsdom can't reload; the page has marked the reload and waits for it instead of retrying or erroring.
    expect(sessionStorage.getItem("eft:reloaded-for-chunk:/page/missing-chunk")).toBe("1");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("Something went wrong");
    expect(errorKinds()).toEqual(["chunk_load"]);

    // After that reload (same tab, so the mark is still there; a new page load, so a new count), a
    // second failure says the page couldn't load, and Try Again loads the page afresh.
    act(() => root.unmount());
    root = createRoot(host);
    resetReportedPageErrors();
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    await renderPage("/page/missing-chunk", vi.fn().mockRejectedValue(chunkError()));
    expect(text()).toContain("Couldn\u2019t load this page. Check your connection and try again.");
    expect(text()).not.toContain("Something went wrong");
    expect(errorKinds()).toEqual(["chunk_load", "chunk_load"]);
    await act(async () => host.querySelector("button")!.click());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("records a page's failure once per page load, however often Try Again fails", async () => {
    const loader = vi.fn((): Promise<null> => Promise.reject(new TypeError("e.buyFor is undefined")));
    await renderPage("/page/still-broken", loader);
    for (let index = 0; index < 3; index += 1) {
      await act(async () => host.querySelector("button")!.click());
      await settle();
    }
    expect(loader).toHaveBeenCalledTimes(4);
    expect(errorKinds()).toEqual(["crash"]);
  });
});

describe("a page from an earlier deploy whose code is gone", () => {
  // The page came from build A; the site now serves build B, so A's chunks answer 404.
  const GONE = "/assets/routes-B5NDp1i5.js";
  const goneError = () => new TypeError(`Failed to fetch dynamically imported module: ${location.origin}${GONE}`);
  let entry: HTMLScriptElement;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    entry = Object.assign(document.createElement("script"), { type: "module", src: "/assets/index-AAAAaaaa.js" });
    document.head.append(entry);
    reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, origin: window.location.origin, href: window.location.href, reload });
    vi.stubGlobal("fetch", vi.fn((input: string) => Promise.resolve(new Response(null, { status: new URL(input, location.href).pathname === GONE ? 404 : 200 }))));
  });

  afterEach(() => {
    entry.remove();
    resetStaleBuildReloads();
  });

  it("reloads onto the current version instead of showing the error, recorded as stale_build only", async () => {
    await renderPage("/page/old-tab", vi.fn().mockRejectedValue(goneError()));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Loading");
    expect(text()).not.toContain("ERROR");
    expect(errorKinds()).toEqual(["stale_build"]);
    // Not the plain once-per-URL reload's mark: this one is per build.
    expect(sessionStorage.getItem("eft:reloaded-for-chunk:/page/old-tab")).toBeNull();
  });

  it("takes over the router's own reload for a route chunk that's gone", async () => {
    handOverChunkErrors();
    // As Vite's import wrapper does: report the failure, then reject with it.
    const importer = (): Promise<{ default: () => React.ReactNode }> => {
      const error = goneError();
      window.dispatchEvent(Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload: error }));
      return Promise.reject(error);
    };
    await renderPage("/page/old-tab", () => null, undefined, lazyRouteComponent(importer) as () => React.ReactNode);
    // One reload, the page's own (onto the new version), recorded as stale_build.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(errorKinds()).toEqual(["stale_build"]);
    expect(text()).not.toContain("ERROR");
  });

  it("shows the error, without another reload, when the reloaded page is still that version", async () => {
    await renderPage("/page/old-tab", vi.fn().mockRejectedValue(goneError()));
    // The reload brought back the same build (a deploy that is itself broken): a new page load in the same tab.
    act(() => root.unmount());
    root = createRoot(host);
    resetReportedPageErrors();
    beacons.length = 0;
    await renderPage("/page/old-tab", vi.fn().mockRejectedValue(goneError()));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Couldn\u2019t load this page");
    expect(errorKinds()).toEqual(["chunk_load"]);
  });

  // Safari doesn't name the script (so the second try is the import again): the page's entry is asked for.
  const safariError = () => new TypeError("Importing a module script failed.");

  it("swaps the map for the current version too, without the notice", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string) => Promise.resolve(new Response(null, { status: input === entry.getAttribute("src") ? 404 : 200 }))));
    const load = vi.fn().mockRejectedValue(safariError());
    const Map = browserOnly(load, (module: { Canvas: () => React.ReactNode }) => module.Canvas);
    await renderPage("/page/factory", () => null, undefined, () => <Map />);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Loading map");
    expect(text()).not.toContain("Couldn't load the map");
    expect(errorKinds()).toEqual(["stale_build"]);
  });

  it("keeps the connection notice when the map's code is still on the site", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
    const Map = browserOnly(() => Promise.reject(safariError()), (module: { Canvas: () => React.ReactNode }) => module.Canvas);
    await renderPage("/page/factory", () => null, undefined, () => <Map />);
    expect(reload).not.toHaveBeenCalled();
    expect(text()).toContain("Couldn't load the map");
    expect(errorKinds()).toEqual(["chunk_load"]);
  });
});

describe("a lazily loaded map whose code didn't download", () => {
  // A page in a real router, with the map canvas in it.
  async function renderMap(load: () => Promise<{ Canvas: () => React.ReactNode }>) {
    const Map = browserOnly(load, (module) => module.Canvas);
    return renderPage("/page/factory", () => null, undefined, () => (
      <div>
        <h1>Factory</h1>
        <Map />
      </div>
    ));
  }

  it("says so in the map's place, records it once, and Retry loads it", async () => {
    // The import and its automatic second try both fail (no script URL, so the second try is the import again).
    const load = vi.fn().mockRejectedValue(new TypeError("Importing a module script failed."));
    await renderMap(load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Factory");
    expect(text()).toContain("Couldn't load the map");
    expect(text()).toContain("Check your connection and try again.");
    expect(text()).not.toContain("Something went wrong");
    expect(beacons.filter((beacon) => beacon.event === "page.error")).toEqual([{ event: "page.error", route: "other", errorKind: "chunk_load" }]);

    // Retry fails too: still the notice, still one event.
    const retry = () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!;
    await act(async () => retry().click());
    await settle();
    expect(load).toHaveBeenCalledTimes(3);
    expect(text()).toContain("Couldn't load the map");
    expect(errorKinds()).toEqual(["chunk_load"]);

    load.mockResolvedValue({ Canvas: () => <p>Map canvas</p> });
    await act(async () => retry().click());
    await settle();
    expect(text()).toContain("Map canvas");
    expect(text()).toContain("Factory");
    expect(sessionStorage.length).toBe(0);
  });

  it("recovers by itself when the second try works, without recording anything", async () => {
    const load = vi.fn().mockRejectedValueOnce(new TypeError("Importing a module script failed.")).mockResolvedValue({ Canvas: () => <p>Map canvas</p> });
    await renderMap(load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Map canvas");
    expect(errorKinds()).toEqual([]);
  });

  it("leaves any other error to the page's error boundary", async () => {
    await renderMap(() => Promise.reject(new TypeError("L.map is not a function")));
    expect(text()).toContain("Something went wrong");
    expect(errorKinds()).toEqual(["crash"]);
  });
});

describe("an item page whose item didn't load in time", () => {
  const ITEM: ComposedItem = {
    id: "5d5d940f86f7742797262046",
    normalizedName: "shutter-glasses-red",
    name: "Red shutter glasses",
    shortName: "Shutter",
    gridImageLink: null,
    wikiLink: null,
    fleaMarketFee: 0,
    width: 1,
    height: 1,
    changeLast48hPercent: null,
    buyFor: [],
    sellFor: [{ vendor: { name: "Therapist" }, priceRUB: 9_000 }],
    usedInTasks: [],
    hideoutRequirements: [],
    hideoutSlots: [],
    bartersUsing: [],
    craftsUsing: [],
  };

  it("loads the item in the browser instead of showing the error page", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    apiFetch.mockResolvedValue(ITEM);
    const loader = vi.fn().mockRejectedValue(new RenderDataUnavailableError("Item page"));
    const rootRoute = createRootRoute({ component: () => <GameModeProvider><Outlet /></GameModeProvider> });
    // The real route's error component, on a route with the same id so its params resolve.
    const page = createRoute({ getParentRoute: () => rootRoute, path: "/item/$itemName", loader, errorComponent: ItemRoute.options.errorComponent });
    const router = createRouter({
      routeTree: rootRoute.addChildren([page]),
      history: createMemoryHistory({ initialEntries: ["/item/shutter-glasses-red"] }),
    });
    await act(async () => root.render(<RouterProvider router={router} />));
    await settle();

    expect(text()).toContain("Red shutter glasses");
    expect(text()).not.toContain("Something went wrong");
    expect(apiFetch).toHaveBeenCalledWith("item.detail", expect.objectContaining({ slug: "shutter-glasses-red" }), expect.anything());
    // The loader isn't retried: the item comes through the browser's own request.
    expect(loader).toHaveBeenCalledTimes(1);
    expect(beacons.filter((beacon) => beacon.event === "page.error")).toEqual([
      { event: "page.error", route: "/item/$itemName", errorKind: "unavailable" },
    ]);
  });
});
