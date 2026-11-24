import type { DurableBindings } from "./access";

/**
 * Side effects on other Durable Objects (§5.1, rule 3): queued in the caller's `outbox` table in
 * the same transaction as the change that causes them, and delivered by its alarm with backoff.
 * Alarms run at least once, so every method listed here is idempotent.
 */
export interface OutboxStore {
  dueOutbox(limit?: number): { id: number; target: string; method: string; args: unknown[]; attempts: number }[];
  outboxDone(id: number): void;
  outboxRetry(id: number): void;
}

/** What each kind of target accepts from an outbox. Anything else is dropped. */
const ALLOWED: Record<string, readonly string[]> = {
  user: ["forgetPlan", "touchPlan", "setPlanEntry", "addNotice", "receiveOwnership"],
  plan: ["memberRenamed", "removeMember", "ownerDeparting"],
  link: ["destroy"],
};

function stub(env: DurableBindings, kind: string, name: string): Record<string, (...args: unknown[]) => Promise<unknown>> | null {
  if (kind === "user") return env.USER.getByName(name) as never;
  if (kind === "plan") return env.PLAN.getByName(name) as never;
  if (kind === "link") return env.LINK.getByName(name) as never;
  return null;
}

/** Delivers due items; a failure is retried later with backoff, and never stops the rest. */
export async function drainOutbox(env: DurableBindings, store: OutboxStore) {
  for (let round = 0; round < 5; round += 1) {
    const due = store.dueOutbox();
    if (due.length === 0) return;
    for (const item of due) {
      const separator = item.target.indexOf(":");
      const kind = item.target.slice(0, separator);
      const name = item.target.slice(separator + 1);
      const target = ALLOWED[kind]?.includes(item.method) ? stub(env, kind, name) : null;
      if (!target) {
        store.outboxDone(item.id);
        continue;
      }
      try {
        await target[item.method](...item.args);
        store.outboxDone(item.id);
      } catch (error) {
        console.error(JSON.stringify({ event: "outbox_retry", kind, method: item.method, attempts: item.attempts, error: String(error) }));
        store.outboxRetry(item.id);
      }
    }
  }
}
