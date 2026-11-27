// Bumped when the cached files change shape: v4 is the first TanStack Start build (hashed files in /assets/).
const VERSION = "v4";
// The build this worker came with, written in by the build (vite.config.ts, serviceWorkerBuild). It
// names the page cache, so a deploy (which changes this file, so browsers install it) drops the
// previous version's pages: their scripts are gone from the site.
const BUILD = "__EFT_BUILD__";
const STATIC_CACHE = `eft-static-${VERSION}`;
const PAGE_CACHE = `eft-pages-${VERSION}-${BUILD}`;
const DATA_CACHE = `eft-data-${VERSION}`;
const CACHES = [STATIC_CACHE, PAGE_CACHE, DATA_CACHE];
const LIMITS = { [PAGE_CACHE]: 40, [DATA_CACHE]: 200 };
const NETWORK_TIMEOUT_MS = 4000;
const MAX_PAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("eft-") && !CACHES.includes(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname === "/api/tarkov") {
    event.respondWith(networkFirst(request, DATA_CACHE));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGE_CACHE, offlinePage));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE).catch(() => null);
  if (!cache) return fetch(request);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

/**
 * The network's answer, kept for next time. A kept copy stands in when the network fails, or is
 * still answering after a few seconds; without a copy a slow answer is waited for, and only a
 * failed one gets the fallback (the offline page).
 */
async function networkFirst(request, cacheName, fallback) {
  const cache = await caches.open(cacheName).catch(() => null);
  const network = fetch(request);
  if (!cache) return network.catch((error) => (fallback ? fallback() : Promise.reject(error)));
  const kept = network.then((response) => keep(cache, cacheName, request, response));
  try {
    return await withTimeout(kept, NETWORK_TIMEOUT_MS);
  } catch {
    const cached = await cache.match(request).catch(() => undefined);
    if (cached && (cacheName !== PAGE_CACHE || isFresh(cached))) return cached;
    try {
      return await kept;
    } catch (error) {
      if (fallback) return fallback();
      throw error;
    }
  }
}

async function keep(cache, cacheName, request, response) {
  if (response.ok && response.type === "basic") {
    try {
      await cache.put(request, response.clone());
      await trim(cache, LIMITS[cacheName]);
    } catch {
      // Not kept; the answer still goes to the page.
    }
  }
  return response;
}

function isFresh(response) {
  const date = Date.parse(response.headers.get("date") || "");
  return Number.isFinite(date) && Date.now() - date < MAX_PAGE_AGE_MS;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function trim(cache, limit) {
  if (!limit) return;
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)));
}

function offlinePage() {
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline | EFT Toolset</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#080808;color:#ccc;font:14px system-ui,sans-serif;text-align:center"><div><p style="color:#9a8866;letter-spacing:.2em;text-transform:uppercase;font-weight:700">Offline</p><p>This page has not been saved for offline use yet.</p><p><a href="/" style="color:#d4b86a">Try the home page</a></p></div></body></html>',
    {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      },
    }
  );
}
