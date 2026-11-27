import { failedChunkUrl, pageErrorKind } from "@/app/lib/usage/page-error";

/**
 * Recovers a page that is still running code from an earlier deploy. Workers Static Assets serves
 * only the current deployment's files, so once a new version is out, a page loaded before it (a tab
 * left open, a restored tab, a page the service worker kept) gets a 404 for any chunk it hasn't
 * loaded yet. Asking again can't help; only a fresh page load, onto the new version, can.
 */

/** The prefix of Vite's hashed build files, the only files that go away with a deploy. */
const ASSETS = "/assets/";
const PROBE_TIMEOUT_MS = 5000;
/** Long enough for the service worker to be let go of; a reload goes ahead regardless after it. */
const RELEASE_TIMEOUT_MS = 2000;
const RELOAD_KEY = "eft:stale-build-reload:";
/** The service worker's page cache (public/sw.js), which may hold the old version's HTML. */
const PAGE_CACHE_PREFIX = "eft-pages-";

/**
 * The script that started this page: Vite names it by its content, and it names every other chunk,
 * so it stands for the build the page came from. Null outside a built page (development, tests).
 */
export function pageBuild(doc: Document = document): string | null {
  for (const script of doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
    const path = assetPath(script.src);
    if (path) return path;
  }
  return null;
}

/** The URL's path when it is one of this site's build files, else null. */
function assetPath(url: string): string | null {
  try {
    const parsed = new URL(url, location.href);
    return parsed.origin === location.origin && parsed.pathname.startsWith(ASSETS) ? parsed.pathname : null;
  } catch {
    return null;
  }
}

/** True when the site answers that the file doesn't exist. No answer, or any other, isn't proof. */
async function gone(path: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // HEAD isn't answered by the service worker (it handles GETs) or the HTTP cache (no-store).
    const response = await fetch(path, { method: "HEAD", cache: "no-store", credentials: "same-origin", signal: controller.signal });
    return response.status === 404 || response.status === 410;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a chunk that didn't download is gone because a newer version replaced this page's. The
 * file the browser named is asked for; without one (Safari doesn't say), the page's own entry
 * script is, which a deploy replaces whenever any chunk it can load changed. A file that is still
 * there, or no answer at all, means the visitor's connection, not the deploy.
 */
export async function isStaleBuild(error: unknown): Promise<boolean> {
  if (pageErrorKind(error) !== "chunk_load") return false;
  const named = failedChunkUrl(error);
  const path = named ? assetPath(named) : pageBuild();
  return path !== null && (await gone(path));
}

/**
 * Marks the one automatic reload this build gets in this tab, or says it already had it. The mark
 * lives in sessionStorage, or in window.name (kept across a reload in the same tab) when storage is
 * blocked; with neither, no mark could be read back, so it never reloads.
 */
function claimReload(build: string): boolean {
  const key = RELOAD_KEY + build;
  try {
    if (sessionStorage.getItem(key) !== null) return false;
    sessionStorage.setItem(key, "1");
    if (sessionStorage.getItem(key) === "1") return true;
  } catch {
    // No storage: the window's name below.
  }
  try {
    if (window.name === key) return false;
    window.name = key;
    return window.name === key;
  } catch {
    return false;
  }
}

/** Forgets this tab's reload marks. For tests. */
export function resetStaleBuildReloads() {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(RELOAD_KEY)) sessionStorage.removeItem(key);
  } catch {
    // Nothing to forget.
  }
  if (window.name.startsWith(RELOAD_KEY)) window.name = "";
}

function withTimeout(promise: Promise<unknown>, ms: number) {
  return Promise.race([promise.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))]);
}

/**
 * Loads the page afresh from the network. The service worker is let go first: it answers a page it
 * can't fetch within a few seconds from its cache, which could be the old version again. The reload
 * then goes straight to the site, and the new page registers the current worker. Its kept pages
 * are dropped too, and a reload never comes from the back/forward cache.
 */
async function reloadFromNetwork() {
  const release = (async () => {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(PAGE_CACHE_PREFIX)).map((key) => caches.delete(key)));
  })();
  await withTimeout(release, RELEASE_TIMEOUT_MS);
  window.location.reload();
}

/** TanStack Router's mark for the reload it makes when a route's chunk is missing (lazyRouteComponent). */
const ROUTER_RELOAD_KEY = "tanstack_router_reload:";

/**
 * Hands a chunk that didn't download to the page's own recovery. TanStack Router reloads the page
 * once by itself when a route's chunk is missing: a plain reload, which the service worker may answer
 * with the same old page, and which records nothing. Vite reports every failed dynamic import first
 * (`vite:preloadError`), so the router's reload is marked as done there, and the failure reaches the
 * route's error page (RouteErrorPage), which tells a replaced version from a dropped connection.
 */
export function handOverChunkErrors(target: Window = window) {
  target.addEventListener("vite:preloadError", (event) => {
    const error = (event as Event & { payload?: unknown }).payload;
    if (pageErrorKind(error) !== "chunk_load") return;
    try {
      sessionStorage.setItem(ROUTER_RELOAD_KEY + (error as Error).message, "1");
    } catch {
      // No storage: the router can't mark its reload either, and lets the error through.
    }
  });
}

export type StaleBuildRecovery =
  /** The page is reloading onto the current version; show it loading. */
  | "reloading"
  /** The file is gone but this build already had its reload in this tab: show the error. */
  | "gone"
  /** Not an old version's missing file, or it couldn't tell: the usual recovery. */
  | "none";

const checks = new WeakMap<object, Promise<StaleBuildRecovery>>();

/**
 * For a chunk that didn't download: when this page's version has been replaced, reloads once (per
 * build, per tab) onto the current one, calling `onReload` first so it can be recorded. Asked again
 * for the same error (an error page remounting), it answers from the first check.
 */
export function recoverFromStaleBuild(error: unknown, onReload: () => void): Promise<StaleBuildRecovery> {
  if (pageErrorKind(error) !== "chunk_load") return Promise.resolve("none");
  const key = typeof error === "object" && error !== null ? error : null;
  const known = key ? checks.get(key) : undefined;
  if (known) return known;
  const check = (async (): Promise<StaleBuildRecovery> => {
    if (!(await isStaleBuild(error))) return "none";
    const build = pageBuild() ?? failedChunkUrl(error) ?? "unknown";
    if (!claimReload(build)) return "gone";
    onReload();
    void reloadFromNetwork();
    return "reloading";
  })();
  if (key) checks.set(key, check);
  return check;
}
