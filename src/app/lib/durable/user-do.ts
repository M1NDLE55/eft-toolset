import { DurableObject } from "cloudflare:workers";
import type { BucketLimit, RequestBudget } from "@/app/lib/api/rate-limit-store";
import { outcome, type Outcome } from "./outcome";
import type { Sql } from "./sql";
import { UserStore, type PlanIndexEntry, type PlanRole, type Profile, type SavedEntry } from "./user-store";

type EntryKind = "builds" | "item_groups";

/**
 * One per user, named by their WorkOS user id (see access.ts). Holds the user's profile, saved
 * builds and item groups, the index of raid plans they own or that are shared with them, and their
 * MCP budget, in SQLite. No user-facing feature reads it yet apart from the MCP budget.
 */
export class UserDO extends DurableObject<Env> {
  private readonly store: UserStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new UserStore(ctx.storage.sql as unknown as Sql, (work) => ctx.storage.transactionSync(work));
    void ctx.blockConcurrencyWhile(async () => {
      this.store.migrate();
    });
  }

  chargeBudget(key: string, limit: BucketLimit, cost: number, refundOnDenial: number): RequestBudget {
    return this.store.chargeBudget(key, limit, cost, refundOnDenial);
  }

  profile(): Profile | null {
    return this.store.profile();
  }

  saveProfile(userId: string, details: { email?: string | null; name?: string | null }): Profile {
    return this.store.saveProfile(userId, details);
  }

  listEntries(kind: EntryKind): SavedEntry[] {
    return this.store.listEntries(kind);
  }

  saveEntry(kind: EntryKind, entry: { id: string; name: string; data: unknown }): Outcome<null> {
    return outcome(() => {
      this.store.saveEntry(kind, entry);
      return null;
    });
  }

  deleteEntry(kind: EntryKind, id: string) {
    this.store.deleteEntry(kind, id);
  }

  plans(): PlanIndexEntry[] {
    return this.store.plans();
  }

  reservePlanCreation(): Outcome<null> {
    return outcome(() => {
      this.store.reservePlanCreation();
      return null;
    });
  }

  recordPlan(
    entry: { planId: string; role: PlanRole; title: string; map: string; updatedAt: number },
    source: "created" | "shared" | "transferred"
  ): Outcome<null> {
    return outcome(() => {
      this.store.recordPlan(entry, source);
      return null;
    });
  }

  touchPlan(planId: string, details: { title: string; map: string; updatedAt: number }) {
    this.store.touchPlan(planId, details);
  }

  forgetPlan(planId: string) {
    this.store.forgetPlan(planId);
  }

  usage() {
    return this.store.usage();
  }
}
