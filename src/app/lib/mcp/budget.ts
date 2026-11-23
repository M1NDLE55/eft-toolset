import { CLIENT_LIMIT, consumeGlobalBudget, type BucketLimit, type RequestBudget } from "@/app/lib/api/rate-limit";
import { sharedRateLimitStore, USER_KEY_PREFIX } from "@/app/lib/api/rate-limit-store";

/**
 * Anonymous payers exist only when sign-in is off, which is only allowed outside production.
 * ip is null when no trusted IP header is configured.
 */
export type Payer = { kind: "anonymous"; ip: string | null } | { kind: "user"; subject: string };

// Below the instance's global MCP budget (240, 4/s), so one user can't take all of it.
const DEFAULT_USER_LIMIT: BucketLimit = { burst: 160, refillPerSecond: 3 };

export function mcpPayerLimits(): Record<Payer["kind"], BucketLimit> {
  return {
    anonymous: CLIENT_LIMIT,
    user: {
      burst: positiveNumber("MCP_USER_RATE_BURST", DEFAULT_USER_LIMIT.burst),
      refillPerSecond: positiveNumber("MCP_USER_RATE_PER_SECOND", DEFAULT_USER_LIMIT.refillPerSecond),
    },
  };
}

function positiveNumber(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function payerKey(payer: Payer) {
  if (payer.kind === "user") return `${USER_KEY_PREFIX}${payer.subject}`;
  return payer.ip === null ? null : `mcp:ip:${payer.ip}`;
}

/** On denial, both budgets get back this charge and paidEarlier. */
export async function chargeMcpBudget(payer: Payer, cost: number, paidEarlier = 0): Promise<RequestBudget> {
  const store = sharedRateLimitStore();
  const key = payerKey(payer);
  const limit = mcpPayerLimits()[payer.kind];
  if (key !== null) {
    const result = await store.consume(key, limit, cost, paidEarlier);
    if (!result.allowed) {
      consumeGlobalBudget("mcp", -paidEarlier);
      return result;
    }
  }
  const global = consumeGlobalBudget("mcp", cost, paidEarlier);
  if (global.allowed) return global;
  if (key !== null) await store.consume(key, limit, -(cost + paidEarlier));
  return global;
}
