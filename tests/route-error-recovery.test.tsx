import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
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

const { RouteErrorPage } = await import("@/app/components/global/route-status");
const { Route: ItemRoute } = await import("@/routes/item/$itemName");
const { GameModeProvider } = await import("@/components/game-mode/context");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  beacons.length = 0;
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
async function renderPage(path: string, loader: () => unknown, errorComponent?: (props: ErrorComponentProps) => React.ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "/page/$name",
    loader,
    component: () => <p>Page loaded</p>,
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
    expect(errorKinds()).toEqual(["unavailable", "unavailable"]);

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

    // After that reload (same tab, so the mark is still there), a second failure shows the error.
    act(() => root.unmount());
    root = createRoot(host);
    await renderPage("/page/missing-chunk", vi.fn().mockRejectedValue(chunkError()));
    expect(text()).toContain("Something went wrong");
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
