import { accountConfig, workosClient } from "@/app/lib/account/server";

/**
 * Account totals for the stats: how many accounts exist and how many were made each day, counted
 * from WorkOS's user list. Only the creation dates are read; nothing about a user is kept, and the
 * counts are never joined to usage events.
 */
export interface AccountTotals {
  total: number;
  /** New accounts per UTC day (YYYY-MM-DD), for the days the list reached. */
  newByDay: Record<string, number>;
  /** True when the list was longer than MAX_PAGES and total is a lower bound. */
  capped: boolean;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const CACHE_MS = 60 * 60 * 1000;

let cached: { at: number; totals: Promise<AccountTotals | null> } | undefined;

async function countAccounts(): Promise<AccountTotals | null> {
  const config = accountConfig();
  if (!config) return null;
  const users = workosClient(config).userManagement;
  const newByDay: Record<string, number> = {};
  let total = 0;
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const list = await users.listUsers({ limit: PAGE_SIZE, order: "desc", after });
    for (const user of list.data) {
      total += 1;
      const day = new Date(user.createdAt).toISOString().slice(0, 10);
      newByDay[day] = (newByDay[day] ?? 0) + 1;
    }
    after = list.listMetadata.after ?? undefined;
    if (!after) return { total, newByDay, capped: false };
  }
  return { total, newByDay, capped: true };
}

/** The totals, counted at most once an hour per isolate; null when accounts are off or WorkOS fails. */
export async function accountTotals(now = Date.now()): Promise<AccountTotals | null> {
  if (!cached || now - cached.at > CACHE_MS) {
    const totals = countAccounts().catch((error: unknown) => {
      console.error("Account totals could not be counted", error instanceof Error ? error.message : "unknown error");
      cached = undefined;
      return null;
    });
    cached = { at: now, totals };
  }
  return cached.totals;
}

export function clearAccountTotals() {
  cached = undefined;
}
