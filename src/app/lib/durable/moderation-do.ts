import { DurableObject } from "cloudflare:workers";
import { outcome, type Outcome } from "./outcome";
import { ModerationStore, type CaseRow, type Decision, type ReportInput } from "./moderation-store";
import type { Sql } from "./sql";

/** The single report queue, named "moderation" (§6.4, §16.6). Reports are few, so one object is plenty. */
export class ModerationDO extends DurableObject<Env> {
  private readonly store: ModerationStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new ModerationStore(ctx.storage.sql as unknown as Sql, (work) => ctx.storage.transactionSync(work));
    void ctx.blockConcurrencyWhile(async () => {
      this.store.migrate();
    });
  }

  chargeAnonymous(reporter: string): Outcome<null> {
    return outcome(() => {
      this.store.chargeAnonymous(reporter);
      return null;
    });
  }

  report(input: ReportInput): Outcome<{ duplicate: boolean; pause: boolean }> {
    return outcome(() => this.store.report(input));
  }

  queue(): CaseRow[] {
    return this.store.queue();
  }

  caseRow(subject: string): CaseRow | null {
    return this.store.caseRow(subject);
  }

  async decide(subject: string, decision: Decision): Promise<Outcome<CaseRow>> {
    const result = outcome(() => this.store.decide(subject, decision));
    await this.schedule();
    return result;
  }

  async closeCasesFor(targetKind: "user" | "plan", targetName: string) {
    this.store.closeCasesFor(targetKind, targetName);
    await this.schedule();
  }

  private async schedule() {
    const due = this.store.sweep();
    if (due !== null) await this.ctx.storage.setAlarm(due);
  }

  async alarm() {
    await this.schedule();
  }
}
