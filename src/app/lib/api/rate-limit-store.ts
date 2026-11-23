import { platform, type BucketLimit, type RequestBudget } from "@/app/lib/server/platform";

export type { BucketLimit, RequestBudget };

const MAX_MEMORY_ENTRIES = 10_000;

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

/** Negative costs refund; refundOnDenial atomically refunds an earlier charge on denial. Never throws. */
export interface RateLimitStore {
  readonly kind: "memory" | "durable";
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

/**
 * Where MCP payers' budgets are kept: in the Worker, a signed-in user's bucket lives in their UserDO
 * (exact: a Durable Object runs one request at a time), so every isolate sees the same budget. Other
 * keys, and everything outside the Worker, are counted in this isolate's memory.
 */
export function sharedRateLimitStore(): RateLimitStore {
  const charge = platform().chargeUserBudget;
  if (!charge) return memoryRateLimitStore;
  return {
    kind: "durable",
    async consume(key, limit, cost, refundOnDenial) {
      const userId = key.startsWith(USER_KEY_PREFIX) ? key.slice(USER_KEY_PREFIX.length) : null;
      if (userId === null) return memoryRateLimitStore.consume(key, limit, cost, refundOnDenial);
      try {
        return await charge(userId, limit, cost, refundOnDenial ?? 0);
      } catch (error) {
        // The user's Durable Object couldn't be reached: count in memory rather than fail the request.
        console.warn("MCP budget fell back to memory:", error instanceof Error ? error.message : error);
        return memoryRateLimitStore.consume(key, limit, cost, refundOnDenial);
      }
    },
  };
}

/** The key prefix MCP budgets use for signed-in users (see src/app/lib/mcp/budget.ts). */
export const USER_KEY_PREFIX = "mcp:user:";
