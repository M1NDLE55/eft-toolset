/**
 * The secrets behind the anonymous daily and weekly ids (identity.ts): one random 32-byte key per
 * UTC day and one per ISO week (Monday to Sunday, UTC). Only the current period's key is ever kept;
 * the previous one is deleted as soon as the period ends (UsageSaltDO's alarm) or the next key is
 * asked for, whichever comes first. Once a key is gone, nobody, including us, can recompute which
 * subject an id stood for. Keys are never logged.
 *
 * Runs inside a Durable Object, so there is exactly one key per period across every isolate; the
 * storage is an interface so tests can run it in memory.
 */

export type SaltPeriod = "day" | "week";

export interface SaltStorage {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  delete(keys: string[]): Promise<unknown>;
  list(): Promise<Map<string, string>>;
}

export interface PeriodSecret {
  /** The period it belongs to, such as "day:2026-11-24" or "week:2026-W48". */
  period: string;
  /** 64 hex characters. */
  secret: string;
  /** When the period ends (ms since the epoch); the key must not be used after this. */
  expiresAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(now: number) {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

/** The current period's name and its end, in UTC. */
export function currentPeriod(kind: SaltPeriod, now: number): { period: string; expiresAt: number } {
  const dayStart = startOfUtcDay(now);
  if (kind === "day") {
    return { period: `day:${new Date(dayStart).toISOString().slice(0, 10)}`, expiresAt: dayStart + DAY_MS };
  }
  // ISO 8601 week: Monday first; the week belongs to the year that holds its Thursday.
  const weekday = (new Date(dayStart).getUTCDay() + 6) % 7;
  const monday = dayStart - weekday * DAY_MS;
  const thursday = new Date(monday + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const firstThursday = Date.UTC(year, 0, 4) - ((new Date(Date.UTC(year, 0, 4)).getUTCDay() + 6) % 7) * DAY_MS + 3 * DAY_MS;
  const week = 1 + Math.round((thursday.getTime() - firstThursday) / (7 * DAY_MS));
  return { period: `week:${year}-W${String(week).padStart(2, "0")}`, expiresAt: monday + 7 * DAY_MS };
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class SaltStore {
  constructor(
    private readonly storage: SaltStorage,
    private readonly newSecret: () => string = randomSecret
  ) {}

  /** The current period's key, made now if this is the period's first event. Older keys are deleted first. */
  async secret(kind: SaltPeriod, now = Date.now()): Promise<PeriodSecret> {
    await this.purge(now);
    const { period, expiresAt } = currentPeriod(kind, now);
    let secret = await this.storage.get(period);
    if (!secret) {
      secret = this.newSecret();
      await this.storage.put(period, secret);
    }
    return { period, secret, expiresAt };
  }

  /** Deletes every key that isn't the current day's or week's. Returns when the next one expires. */
  async purge(now = Date.now()): Promise<number> {
    const day = currentPeriod("day", now);
    const week = currentPeriod("week", now);
    const keep = new Set([day.period, week.period]);
    const stale = [...(await this.storage.list()).keys()].filter((key) => !keep.has(key));
    if (stale.length) await this.storage.delete(stale);
    return Math.min(day.expiresAt, week.expiresAt);
  }
}

/** A SaltStorage in memory, for tests and for running outside the Worker. */
export function memorySaltStorage(): SaltStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get: async (key) => entries.get(key),
    put: async (key, value) => void entries.set(key, value),
    delete: async (keys) => keys.forEach((key) => entries.delete(key)),
    list: async () => new Map(entries),
  };
}
