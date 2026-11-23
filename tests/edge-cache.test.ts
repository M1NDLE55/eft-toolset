// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { servePage } from "@/app/lib/server/page-cache";
import { edgeCacheHeaders } from "@/app/lib/server/edge-cache";

/** The Workers Cache API in memory: keyed by URL, honouring max-age on put as Cloudflare does. */
function memoryCache() {
  const entries = new Map<string, { response: Response; expires: number }>();
  return {
    entries,
    async match(request: Request) {
      const entry = entries.get(request.url);
      if (!entry || entry.expires <= Date.now()) return undefined;
      const headers = new Headers(entry.response.headers);
      headers.set("CF-Cache-Status", "HIT");
      return new Response(entry.response.clone().body, { status: entry.response.status, headers });
    },
    async put(request: Request, response: Response) {
      const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("Cache-Control") ?? "")?.[1] ?? 0);
      const body = await response.arrayBuffer();
      entries.set(request.url, { response: new Response(body, { status: response.status, headers: response.headers }), expires: Date.now() + maxAge * 1000 });
    },
  };
}

let cache: ReturnType<typeof memoryCache>;
let pending: Promise<unknown>[];
const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext;
const settle = () => Promise.all(pending.splice(0));

beforeEach(() => {
  cache = memoryCache();
  pending = [];
  vi.stubGlobal("caches", { default: cache });
  // The dev server renders afresh; these tests are about the built Worker.
  vi.stubEnv("DEV", false);
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function page(body: string, seconds = 300) {
  return async () => new Response(body, { headers: { "Content-Type": "text/html", ...edgeCacheHeaders(seconds) } });
}

describe("the edge page cache", () => {
  it("renders once, then serves the copy with the old site's Cache-Control and none of its own headers", async () => {
    const render = vi.fn(page("<p>one</p>"));
    const first = await servePage(new Request("https://www.eft-toolset.com/item"), ctx, render);
    await settle();
    const second = await servePage(new Request("https://www.eft-toolset.com/item"), ctx, render);
    expect(await second.text()).toBe("<p>one</p>");
    expect(render).toHaveBeenCalledTimes(1);
    for (const [response, status] of [
      [first, "MISS"],
      [second, "HIT"],
    ] as const) {
      expect(response.headers.get("Cache-Control")).toBe("s-maxage=300, stale-while-revalidate=31535700");
      expect(response.headers.get("X-EFT-Cache")).toBe(status);
      expect(response.headers.get("X-EFT-Edge-TTL")).toBeNull();
      expect(response.headers.get("CF-Cache-Status")).toBeNull();
    }
  });

  it("serves a stale copy while it renders again, and keeps it if that fails", async () => {
    let body = "old";
    const render = vi.fn(async () => (body === "fail" ? new Response("broken", { status: 500 }) : page(body)()));
    await servePage(new Request("https://www.eft-toolset.com/ammo"), ctx, render);
    await settle();
    vi.setSystemTime(Date.now() + 301_000);
    body = "new";
    expect(await (await servePage(new Request("https://www.eft-toolset.com/ammo"), ctx, render)).text()).toBe("old");
    await settle();
    expect(await (await servePage(new Request("https://www.eft-toolset.com/ammo"), ctx, render)).text()).toBe("new");

    vi.setSystemTime(Date.now() + 301_000);
    body = "fail";
    const stale = await servePage(new Request("https://www.eft-toolset.com/ammo"), ctx, render);
    expect(stale.headers.get("X-EFT-Cache")).toBe("STALE");
    await settle();
    expect(await (await servePage(new Request("https://www.eft-toolset.com/ammo"), ctx, render)).text()).toBe("new");
  });

  it("keeps each game mode apart, by the visitor's cookie", async () => {
    const render = vi.fn(async (request: Request) => page(request.headers.get("cookie")?.includes("pve") ? "pve" : "pvp")());
    const pve = { headers: { cookie: "eft-game-mode=pve" } };
    expect(await (await servePage(new Request("https://www.eft-toolset.com/item"), ctx, render)).text()).toBe("pvp");
    expect(await (await servePage(new Request("https://www.eft-toolset.com/item", pve), ctx, render)).text()).toBe("pve");
    await settle();
    expect(await (await servePage(new Request("https://www.eft-toolset.com/item", pve), ctx, render)).text()).toBe("pve");
    expect(await (await servePage(new Request("https://www.eft-toolset.com/item"), ctx, render)).text()).toBe("pvp");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("caches API responses by their own s-maxage, and returns their Cache-Control unchanged", async () => {
    const control = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
    const render = vi.fn(async () => Response.json({ data: 1 }, { headers: { "Cache-Control": control } }));
    await servePage(new Request("https://www.eft-toolset.com/api/tarkov?op=x&v={}"), ctx, render);
    await settle();
    const hit = await servePage(new Request("https://www.eft-toolset.com/api/tarkov?op=x&v={}"), ctx, render);
    expect(hit.headers.get("Cache-Control")).toBe(control);
    expect(render).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 901_000);
    await servePage(new Request("https://www.eft-toolset.com/api/tarkov?op=x&v={}"), ctx, render);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("never stores errors, private responses, responses that set cookies, or anything but GET", async () => {
    const cases: [Request, () => Promise<Response>][] = [
      [new Request("https://x.test/a"), async () => new Response("err", { status: 500, headers: edgeCacheHeaders(300) })],
      [new Request("https://x.test/b"), async () => new Response("p", { headers: { "Cache-Control": "private, no-store" } })],
      [new Request("https://x.test/c"), async () => new Response("c", { headers: { ...edgeCacheHeaders(300), "Set-Cookie": "a=b" } })],
      [new Request("https://x.test/d", { method: "POST" }), page("post")],
      [new Request("https://x.test/e"), async () => new Response("no ttl")],
    ];
    for (const [request, render] of cases) await servePage(request, ctx, render);
    await settle();
    expect(cache.entries.size).toBe(0);
  });
});
