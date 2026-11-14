import { createHash } from "node:crypto";

const MAX_MEMORY_ENTRIES = 10_000;
const UPSTASH_TIMEOUT_MS = 1_000;
const UPSTASH_WARNING_INTERVAL_MS = 60_000;

export interface BucketLimit {
  burst: number;
  refillPerSecond: number;
}

export interface RequestBudget {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

/** Negative costs refund; refundOnDenial atomically refunds an earlier charge on denial. Never throws. */
export interface RateLimitStore {
  readonly kind: "memory" | "upstash";
  consume(key: string, limit: BucketLimit, cost: number, refundOnDenial?: number): Promise<RequestBudget>;
}

export function consumeTokens(
  bucket: TokenBucket,
  limit: BucketLimit,
  now: number,
  cost: number,
  refundOnDenial = 0
): RequestBudget {
  const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(limit.burst, bucket.tokens + elapsedSeconds * limit.refillPerSecond);
  bucket.updatedAt = Math.max(bucket.updatedAt, now);
  if (bucket.tokens >= cost) {
    bucket.tokens = Math.min(limit.burst, bucket.tokens - cost);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  bucket.tokens = Math.min(limit.burst, bucket.tokens + refundOnDenial);
  return { allowed: false, retryAfterSeconds: retryAfter(bucket.tokens, limit, cost + refundOnDenial) };
}

function retryAfter(tokens: number, limit: BucketLimit, cost: number) {
  return Math.max(1, Math.ceil((cost - tokens) / limit.refillPerSecond));
}

/** LRU-capped. */
export class MemoryBuckets {
  private readonly buckets = new Map<string, TokenBucket>();

  consume(key: string, limit: BucketLimit, cost: number, refundOnDenial = 0, now = Date.now()): RequestBudget {
    const bucket = this.buckets.get(key) ?? { tokens: limit.burst, updatedAt: now };
    const result = consumeTokens(bucket, limit, now, cost, refundOnDenial);
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    while (this.buckets.size > MAX_MEMORY_ENTRIES) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey === undefined) break;
      this.buckets.delete(oldestKey);
    }
    return result;
  }

  clear() {
    this.buckets.clear();
  }
}

const memoryBuckets = new MemoryBuckets();

export const memoryRateLimitStore: RateLimitStore & { clear(): void } = {
  kind: "memory",
  consume: async (key, limit, cost, refundOnDenial) => memoryBuckets.consume(key, limit, cost, refundOnDenial),
  clear: () => memoryBuckets.clear(),
};

// Tokens are strings because Redis truncates script numbers to integers.
// The bucket's time never moves backwards, so instance clock skew can't refill it twice.
const TOKEN_BUCKET_SCRIPT = `
local burst = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local refund = tonumber(ARGV[5])
local state = redis.call('HMGET', KEYS[1], 't', 'u')
local tokens = tonumber(state[1]) or burst
local updated = tonumber(state[2]) or now
tokens = math.min(burst, tokens + math.max(0, now - updated) / 1000 * refill)
local allowed = 0
if tokens >= cost then
  tokens = math.min(burst, tokens - cost)
  allowed = 1
else
  tokens = math.min(burst, tokens + refund)
end
redis.call('HSET', KEYS[1], 't', tostring(tokens), 'u', tostring(math.max(updated, now)))
redis.call('PEXPIRE', KEYS[1], math.ceil(burst / refill * 1000) + 1000)
return {allowed, tostring(tokens)}
`;

/** Keys are hashed so IPs and user ids never reach Redis. */
export function upstashRateLimitStore(restUrl: string, token: string, fallback: RateLimitStore = memoryRateLimitStore): RateLimitStore {
  let lastWarning = -Infinity;
  return {
    kind: "upstash",
    async consume(key, limit, cost, refundOnDenial = 0) {
      const now = Date.now();
      try {
        const response = await fetch(restUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify([
            "EVAL",
            TOKEN_BUCKET_SCRIPT,
            "1",
            `eft:rl:${createHash("sha256").update(key).digest("base64url")}`,
            String(limit.burst),
            String(limit.refillPerSecond),
            String(now),
            String(cost),
            String(refundOnDenial),
          ]),
          signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
          cache: "no-store",
        });
        const body = (await response.json()) as { result?: unknown; error?: unknown };
        if (!response.ok || !Array.isArray(body.result)) {
          throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
        }
        const [allowed, tokens] = body.result;
        if (allowed === 1) return { allowed: true, retryAfterSeconds: 0 };
        return { allowed: false, retryAfterSeconds: retryAfter(Number(tokens), limit, cost + refundOnDenial) };
      } catch (error) {
        if (now - lastWarning >= UPSTASH_WARNING_INTERVAL_MS) {
          lastWarning = now;
          console.warn("Upstash rate limiting failed, so this instance is counting in memory.", String(error));
        }
        return fallback.consume(key, limit, cost, refundOnDenial);
      }
    },
  };
}

let shared: { url: string; token: string; store: RateLimitStore } | undefined;

// KV_REST_API_* are the names Vercel may set.
export function sharedRateLimitStore(): RateLimitStore {
  const env = process.env;
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token) return memoryRateLimitStore;
  if (shared?.url !== url || shared.token !== token) shared = { url, token, store: upstashRateLimitStore(url, token) };
  return shared.store;
}
