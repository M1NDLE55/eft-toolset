import { setPlatform, type SharedStore } from "./platform";
import { DATA_ASSET_PREFIX } from "./data-asset-prefix";
import { userObject } from "@/app/lib/durable/access";

/** How long an isolate may keep a KV read before asking again (KV's minimum is 30 seconds). */
const KV_CACHE_TTL_SECONDS = 30;

let installed: Env | undefined;
let currentContext: ExecutionContext | undefined;
/** In `vite dev` only: the dev server, which serves data/ at /_data (see vite.config.ts). */
let devOrigin: string | undefined;

/**
 * Installs the Cloudflare platform: the data snapshot from static assets, KV as the shared store,
 * and waitUntil from the request being served. Called at startup and for each request or cron run.
 */
export function installWorkerPlatform(env: Env, ctx?: ExecutionContext, request?: Request) {
  if (ctx) currentContext = ctx;
  if (import.meta.env.DEV && request) devOrigin = new URL(request.url).origin;
  if (installed === env) return;
  installed = env;
  const kv = env.TARKOV_DATA;
  const sharedStore: SharedStore = {
    get: (key) => kv.get(key, { type: "text", cacheTtl: KV_CACHE_TTL_SECONDS }),
    put: (key, value, options) => kv.put(key, value, options?.expirationTtl ? { expirationTtl: options.expirationTtl } : undefined),
  };
  setPlatform({
    async readDataFile(path) {
      // The built assets hold the snapshot; the dev server serves it from data/ instead.
      const response =
        import.meta.env.DEV && devOrigin
          ? await fetch(`${devOrigin}${DATA_ASSET_PREFIX}/${path}`)
          : await env.ASSETS.fetch(new Request(`https://assets.local${DATA_ASSET_PREFIX}/${path}`));
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        return null;
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    sharedStore,
    trustedClientIpHeader: "cf-connecting-ip",
    chargeUserBudget: (userId, limit, cost, refundOnDenial) =>
      userObject(env, userId).chargeBudget("mcp", limit, cost, refundOnDenial),
    async convertImage(bytes, { width, height, format }) {
      const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
      const result = await env.IMAGES.input(stream).transform({ width, height, fit: "scale-down" }).output({ format });
      return new Uint8Array(await result.response().arrayBuffer());
    },
    async limitClientIp(pool, ip) {
      const limiter = {
        mcp: env.MCP_IP_LIMITER,
        web: env.WEB_IP_LIMITER,
        share: env.SHARE_IP_LIMITER,
        invite: env.INVITE_IP_LIMITER,
        socket: env.SOCKET_IP_LIMITER,
        link: env.LINK_IP_LIMITER,
      }[pool];
      return (await limiter.limit({ key: ip })).success;
    },
    durable: env,
    waitUntil(promise) {
      const guarded = promise.catch((error: unknown) => console.error("Background work failed", error));
      if (currentContext) currentContext.waitUntil(guarded);
      else void guarded;
    },
  });
}
