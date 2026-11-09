const CLIENT_BURST = 120;
const CLIENT_REFILL_PER_SECOND = 2;
const MAX_RATE_LIMIT_ENTRIES = 10_000;

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

export interface RequestBudget {
  allowed: boolean;
  retryAfterSeconds: number;
}

type BudgetPool = "web" | "mcp";

// Each client has a budget per pool, and each pool has a global one, so assistants can't use
// up the website's budget, even when clients can't be told apart.
const GLOBAL_LIMITS: Record<BudgetPool, { burst: number; refill: number }> = {
  web: { burst: 300, refill: 5 },
  mcp: { burst: 240, refill: 4 },
};
const clientBuckets = new Map<string, TokenBucket>();
const globalBuckets: Record<BudgetPool, TokenBucket> = {
  web: { tokens: GLOBAL_LIMITS.web.burst, updatedAt: Date.now() },
  mcp: { tokens: GLOBAL_LIMITS.mcp.burst, updatedAt: Date.now() },
};

export function consumeRequestBudget(request: Request, cost = 1, pool: BudgetPool = "web"): RequestBudget {
  const now = Date.now();
  const client = clientKey(request);
  if (client !== null) {
    const key = `${pool}:${client}`;
    const bucket = clientBuckets.get(key) ?? { tokens: CLIENT_BURST, updatedAt: now };
    const clientResult = consumeTokens(bucket, CLIENT_BURST, CLIENT_REFILL_PER_SECOND, now, cost);
    clientBuckets.delete(key);
    clientBuckets.set(key, bucket);
    while (clientBuckets.size > MAX_RATE_LIMIT_ENTRIES) {
      const oldestKey = clientBuckets.keys().next().value;
      if (oldestKey === undefined) break;
      clientBuckets.delete(oldestKey);
    }
    if (!clientResult.allowed) return clientResult;
  }

  const limits = GLOBAL_LIMITS[pool];
  return consumeTokens(globalBuckets[pool], limits.burst, limits.refill, now, cost);
}

function consumeTokens(
  bucket: TokenBucket,
  capacity: number,
  refillPerSecond: number,
  now: number,
  cost: number
): RequestBudget {
  const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
  bucket.updatedAt = now;
  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((cost - bucket.tokens) / refillPerSecond)),
  };
}

let warnedUntrustedClientIp = false;

/**
 * The client's IP from the header the deployment trusts: CLIENT_IP_HEADER, or X-Real-IP on
 * Vercel. Without one, any forwarding header could be forged, so clients can't be told
 * apart (null) and only the pool's global limit applies.
 */
function clientKey(request: Request) {
  const trustedHeader =
    process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || (process.env.VERCEL ? "x-real-ip" : undefined);
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
  clientBuckets.clear();
  for (const pool of Object.keys(globalBuckets) as BudgetPool[]) {
    globalBuckets[pool].tokens = GLOBAL_LIMITS[pool].burst;
    globalBuckets[pool].updatedAt = Date.now();
  }
}
