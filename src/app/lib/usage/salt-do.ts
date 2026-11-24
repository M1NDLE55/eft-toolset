import { DurableObject } from "cloudflare:workers";
import { currentPeriod, SaltStore, type PeriodSecret, type SaltPeriod } from "./salt-store";

/**
 * The single holder of the usage-stats keys (salt-store.ts), named "usage-salts". Its alarm fires
 * when the current day ends and deletes that day's key even if no event arrives to replace it.
 */
export class UsageSaltDO extends DurableObject<Env> {
  private readonly store: SaltStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new SaltStore({
      get: (key) => ctx.storage.get<string>(key),
      put: (key, value) => ctx.storage.put(key, value),
      delete: (keys) => ctx.storage.delete(keys),
      list: () => ctx.storage.list<string>(),
    });
  }

  async secret(kind: SaltPeriod): Promise<PeriodSecret> {
    const result = await this.store.secret(kind);
    await this.scheduleCleanup();
    return result;
  }

  async alarm() {
    await this.store.purge();
    await this.scheduleCleanup();
  }

  /** Wakes at the end of the current UTC day (which every week ends with too) while any key is held. */
  private async scheduleCleanup(now = Date.now()) {
    if ((await this.ctx.storage.list({ limit: 1 })).size === 0) return;
    const next = currentPeriod("day", now).expiresAt;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next || current <= now) await this.ctx.storage.setAlarm(next);
  }
}
