import {
  consumeTokens,
  memoryRateLimitStore,
  MemoryBuckets,
  type BucketLimit,
  type RequestBudget,
} from "./rate-limit-store";
import { platform } from "@/app/lib/server/platform";

export type { BucketLimit, RequestBudget };
import type { IpPool } from "@/app/lib/server/platform";

export const CLIENT_LIMIT: BucketLimit = { burst: 120, refillPerSecond: 2 };

export type BudgetPool = "web" | "mcp";

// Separate per-instance pools keep MCP traffic from exhausting the website's budget.
const GLOBAL_LIMITS: Record<BudgetPool, BucketLimit> = {
  web: { burst: 300, refillPerSecond: 5 },
  mcp: { burst: 240, refillPerSecond: 4 },
};
const webClients = new MemoryBuckets();
const globalBuckets = {
  web: { tokens: GLOBAL_LIMITS.web.burst, updatedAt: Date.now() },
  mcp: { tokens: GLOBAL_LIMITS.mcp.burst, updatedAt: Date.now() },
};

export function consumeRequestBudget(request: Request, cost = 1): RequestBudget {
  const client = clientIp(request);
  if (client !== null) {
    const clientResult = webClients.consume(`web:${client}`, CLIENT_LIMIT, cost);
    if (!clientResult.allowed) return clientResult;
  }
  return consumeGlobalBudget("web", cost);
}

export function consumeGlobalBudget(pool: BudgetPool, cost: number, refundOnDenial = 0): RequestBudget {
  return consumeTokens(globalBuckets[pool], GLOBAL_LIMITS[pool], Date.now(), cost, refundOnDenial);
}

let warnedUntrustedClientIp = false;

/**
 * The client's IP from the header the deployment trusts: CLIENT_IP_HEADER, or CF-Connecting-IP in
 * the Worker, which Cloudflare sets itself. Without one, any forwarding header could be forged, so
 * clients can't be told apart (null) and only the pool's global limit applies.
 */
export function clientIp(request: Request) {
  const trustedHeader =
    process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || platform().trustedClientIpHeader;
  if (!trustedHeader) {
    if (!warnedUntrustedClientIp && process.env.NODE_ENV === "production") {
      warnedUntrustedClientIp = true;
      console.warn("CLIENT_IP_HEADER is not set, so clients share one global rate limit.");
    }
    return null;
  }
  return (request.headers.get(trustedHeader)?.split(",")[0]?.trim() || "unknown").slice(0, 128);
}

/** Clears every bucket. For tests. */
export function resetRequestBudgets() {
  webClients.clear();
  memoryRateLimitStore.clear();
  for (const pool of Object.keys(globalBuckets) as BudgetPool[]) {
    globalBuckets[pool].tokens = GLOBAL_LIMITS[pool].burst;
    globalBuckets[pool].updatedAt = Date.now();
  }
}

/**
 * The website's limit for one client across every isolate (the Workers rate-limit binding), checked
 * beside the per-isolate buckets above. Null when the request is within it.
 */
export async function crossIsolateLimit(request: Request, pool: BudgetPool | IpPool): Promise<RequestBudget | null> {
  const ip = clientIp(request);
  const limit = platform().limitClientIp;
  if (ip === null || !limit) return null;
  try {
    return (await limit(pool, ip)) ? null : { allowed: false, retryAfterSeconds: 60 };
  } catch {
    return null;
  }
}
