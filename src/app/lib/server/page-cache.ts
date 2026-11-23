import { GAME_MODE_COOKIE, type GameMode } from "@/components/game-mode/mode";
import { EDGE_TTL_HEADER } from "./edge-cache";

/**
 * The edge cache, replacing the old site's ISR and Vercel's CDN. A GET response is kept in the data
 * centre's Cache API when it says how long:
 * - pages, server-function reads and other endpoints with `X-EFT-Edge-TTL: <seconds>` (see
 *   edge-cache.ts), served stale for up to a week while they render again, as ISR did;
 * - API responses with `Cache-Control: public, s-maxage=<n>, stale-while-revalidate=<m>`, exactly
 *   as a CDN would keep them.
 * Entries are keyed by the deployment, the visitor's game mode cookie and the full URL. A stale
 * entry is served while a fresh copy is made in the background; if that fails the old copy stays.
 * Only 200 responses without Set-Cookie are stored.
 */

const RENDERED_AT_HEADER = "X-EFT-Rendered-At";
const STALE_HEADER = "X-EFT-Stale-Seconds";
/** How long a stale page may still be served while it renders again. */
const PAGE_STALE_SECONDS = 7 * 24 * 60 * 60;
/** Identifies this deployment, so a new one never serves the previous one's pages. */
const DEPLOYMENT = import.meta.env.EFT_BUILD_ID ?? "dev";
const CACHE_ORIGIN = "https://page-cache.eft-toolset.internal";

const revalidating = new Set<string>();

interface Lifetime {
  /** Fresh for this long. */
  ttl: number;
  /** Then served stale, while refreshed, for this long. */
  stale: number;
  /** Whether the client gets Cache-Control set as for an ISR page. */
  page: boolean;
}

function gameModeOf(request: Request): GameMode {
  const cookies = request.headers.get("cookie") ?? "";
  const match = new RegExp(`(?:^|;\\s*)${GAME_MODE_COOKIE}=([^;]*)`).exec(cookies);
  return match?.[1] === "pve" ? "pve" : "regular";
}

function cacheKey(request: Request) {
  const url = new URL(request.url);
  return new Request(`${CACHE_ORIGIN}/${DEPLOYMENT}/${gameModeOf(request)}${url.pathname}${url.search}`);
}

function directive(cacheControl: string, name: string) {
  const match = new RegExp(`(?:^|,)\\s*${name}=(\\d+)`, "i").exec(cacheControl);
  return match ? Number(match[1]) : null;
}

/** How long the response may be kept, or null when it may not. */
function lifetimeOf(response: Response): Lifetime | null {
  const edge = Number(response.headers.get(EDGE_TTL_HEADER));
  if (Number.isFinite(edge) && edge > 0) return { ttl: edge, stale: PAGE_STALE_SECONDS, page: true };
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  if (!/(?:^|,)\s*public\b/i.test(cacheControl) || /no-store|private/i.test(cacheControl)) return null;
  const sMaxAge = directive(cacheControl, "s-maxage");
  if (!sMaxAge) return null;
  return { ttl: sMaxAge, stale: directive(cacheControl, "stale-while-revalidate") ?? 0, page: false };
}

function storedLifetime(response: Response): Lifetime {
  const lifetime = lifetimeOf(response);
  const stale = Number(response.headers.get(STALE_HEADER));
  return { ttl: lifetime?.ttl ?? 0, stale: Number.isFinite(stale) ? stale : 0, page: lifetime?.page ?? false };
}

/** The response as the client gets it: the internal headers removed, Cache-Control as the old site sent it. */
function forClient(response: Response, lifetime: Lifetime, status: "HIT" | "STALE" | "MISS") {
  const headers = new Headers(response.headers);
  headers.delete(EDGE_TTL_HEADER);
  headers.delete(RENDERED_AT_HEADER);
  headers.delete(STALE_HEADER);
  if (lifetime.page && !headers.has("Cache-Control")) {
    headers.set("Cache-Control", `s-maxage=${lifetime.ttl}, stale-while-revalidate=${31_536_000 - lifetime.ttl}`);
  }
  headers.set("X-EFT-Cache", status);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function store(cache: Cache, key: Request, response: Response, lifetime: Lifetime) {
  const headers = new Headers(response.headers);
  headers.set(RENDERED_AT_HEADER, String(Date.now()));
  headers.set(STALE_HEADER, String(lifetime.stale));
  // The Cache API drops the entry once it can't be served even stale.
  headers.set("Cache-Control", `public, max-age=${lifetime.ttl + lifetime.stale}`);
  if (!lifetime.page) headers.set("X-EFT-Original-Cache-Control", response.headers.get("Cache-Control") ?? "");
  await cache.put(key, new Response(response.body, { status: response.status, headers }));
}

/** A stored entry's headers as the origin sent them. */
function restore(cached: Response) {
  const original = cached.headers.get("X-EFT-Original-Cache-Control");
  if (original === null) return cached;
  const headers = new Headers(cached.headers);
  headers.set("Cache-Control", original);
  headers.delete("X-EFT-Original-Cache-Control");
  return new Response(cached.body, { status: cached.status, headers });
}

function storable(response: Response) {
  return response.status === 200 && !response.headers.has("Set-Cookie");
}

export async function servePage(
  request: Request,
  ctx: ExecutionContext,
  render: (request: Request) => Promise<Response>
): Promise<Response> {
  // The dev server always renders afresh.
  if (request.method !== "GET" || import.meta.env.DEV || typeof caches === "undefined") return render(request);
  const cache = (caches as unknown as { default: Cache }).default;
  const key = cacheKey(request);
  const cached = await cache.match(key);
  if (cached) {
    const origin = restore(cached);
    const lifetime = storedLifetime(origin);
    const age = (Date.now() - Number(cached.headers.get(RENDERED_AT_HEADER))) / 1000;
    if (age < lifetime.ttl) return forClient(origin, lifetime, "HIT");
    if (age < lifetime.ttl + lifetime.stale) {
      if (!revalidating.has(key.url)) {
        revalidating.add(key.url);
        ctx.waitUntil(
          (async () => {
            try {
              const fresh = await render(request.clone() as Request);
              const freshLifetime = lifetimeOf(fresh);
              if (freshLifetime && storable(fresh)) await store(cache, key, fresh, freshLifetime);
              else void fresh.body?.cancel().catch(() => undefined);
            } catch (error) {
              console.warn("A cached response couldn't be refreshed; the old copy stays.", error);
            } finally {
              revalidating.delete(key.url);
            }
          })()
        );
      }
      return forClient(origin, lifetime, "STALE");
    }
  }

  const response = await render(request);
  const lifetime = lifetimeOf(response);
  if (!lifetime) return response;
  if (!storable(response)) return forClient(response, lifetime, "MISS");
  const [forCache, forVisitor] = response.body ? response.body.tee() : [null, null];
  ctx.waitUntil(store(cache, key, new Response(forCache, response), lifetime).catch(() => undefined));
  return forClient(new Response(forVisitor, response), lifetime, "MISS");
}
