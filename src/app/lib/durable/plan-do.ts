import { DurableObject } from "cloudflare:workers";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import type { PlanOp } from "@/app/lib/sharing/plan-doc";
import type { Role } from "@/app/lib/sharing/types";
import { outcome, type Outcome } from "./outcome";
import { drainOutbox } from "./outbox";
import { PlanStore, type Actor, type Batch, type Member, type PlanLink, type PlanSnapshot, type PlanSummary, type PublicMember } from "./plan-store";
import type { Sql } from "./sql";

export type CatchUp = { batches: Batch[] } | { snapshot: PlanSnapshot };

/**
 * One per raid plan, named by the plan's id. The Worker authenticates callers and passes their user
 * id; this object checks their membership and role for everything (§8.1), applies ops one at a time,
 * and keeps members' plan indexes current through its outbox.
 */
export class PlanDO extends DurableObject<Env> {
  protected readonly store: PlanStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new PlanStore(ctx.storage.sql as unknown as Sql, (work) => ctx.storage.transactionSync(work));
    void ctx.blockConcurrencyWhile(async () => {
      this.store.migrate();
    });
  }

  protected get planId(): string {
    const name = this.ctx.id.name;
    if (!name) throw new Error("PlanDO reached without a name.");
    return name;
  }

  protected async schedule() {
    const due = this.store.nextDue();
    if (due === null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > due) await this.ctx.storage.setAlarm(Math.max(due, Date.now() + 1_000));
  }

  async alarm() {
    this.store.queueSummary(false);
    this.store.sweepLinks();
    await drainOutbox(this.env, this.store);
    await this.schedule();
  }

  // Lifecycle

  init(owner: { id: string; name: string }, content: PlanContent, options: { allowCopy?: boolean; copiedFrom?: string | null } = {}): Outcome<PlanSummary> {
    return outcome(() => this.store.init(this.planId, owner, content, options));
  }

  exists() {
    return this.store.exists();
  }

  summary(): Outcome<PlanSummary> {
    return outcome(() => this.store.summary());
  }

  /** The caller's role, or null: how a UserDO reconciles a stale index entry (§5.1). */
  memberRole(userId: string): Role | null {
    return this.store.exists() ? this.store.role(userId) : null;
  }

  snapshot(userId: string): Outcome<PlanSnapshot> {
    return outcome(() => this.store.snapshot(userId));
  }

  /** Ops after `since` from the log, or a snapshot when the log doesn't reach back that far. */
  since(userId: string, since: number): Outcome<CatchUp> {
    return outcome(() => this.catchUp(userId, since));
  }

  protected catchUp(userId: string | null, since: number, asLink = false): CatchUp {
    const snapshot = asLink ? null : this.store.snapshot(userId);
    const batches = this.store.opsSince(since);
    return batches ? { batches } : { snapshot: snapshot ?? this.store.snapshot(userId, { asLink: true }) };
  }

  /**
   * Applies a batch from an editor or owner (the HTTP route and MCP; the socket path shares it). The
   * answer carries what the caller missed since `knownRev`, so a client without a socket stays in step.
   */
  async apply(actor: Actor & { id: string }, opId: string, ops: PlanOp[], knownRev?: number): Promise<Outcome<{ rev: number; ops: PlanOp[]; duplicate: boolean; catchUp: CatchUp | null }>> {
    const result = outcome(() => this.applyBatch(actor, opId, ops));
    if (!result.ok) return result;
    await this.afterApply(result.value, actor, opId);
    const catchUp = knownRev === undefined ? null : outcome(() => this.catchUp(actor.id, knownRev));
    return { ok: true, value: { ...result.value, catchUp: catchUp?.ok ? catchUp.value : null } };
  }

  protected applyBatch(actor: Actor & { id: string }, opId: string, ops: PlanOp[]) {
    const name = this.store.memberName(actor.id);
    return this.store.apply({ ...actor, name }, opId, ops);
  }

  /** After a batch: members' indexes get the new name at once on a rename, otherwise at most every 10 minutes. */
  protected async afterApply(result: { rev: number; ops: PlanOp[]; duplicate: boolean; renamed: boolean }, _actor: Actor, _opId: string) {
    if (result.duplicate) return;
    this.store.queueSummary(result.renamed);
    await this.schedule();
  }

  // Settings and members

  async setAllowCopy(userId: string, allowCopy: boolean): Promise<Outcome<{ allowCopy: boolean; name: string }>> {
    return outcome(() => this.store.setAllowCopy(userId, allowCopy));
  }

  members(userId: string): Outcome<PublicMember[]> {
    return outcome(() => {
      this.store.requireMember(userId);
      return this.store.publicMembers(userId);
    });
  }

  /** The user behind a member key, for the owner's member actions. Members only. */
  userForKey(viewerId: string, key: string): Outcome<string> {
    return outcome(() => {
      this.store.requireMember(viewerId);
      return this.store.userForKey(key);
    });
  }

  async setRole(ownerId: string, userId: string, role: "editor" | "viewer"): Promise<Outcome<Member[]>> {
    const result = outcome(() => this.store.setRole(ownerId, userId, role));
    if (result.ok) {
      this.store.enqueue(`user:${userId}`, "touchPlan", [this.planId, { ...this.store.summary(), role }]);
      await this.schedule();
      await this.membersChanged({ roleChanged: userId });
    }
    return result;
  }

  /** The owner removes someone, or a member leaves; their index forgets the plan through the outbox. */
  async removeMember(actorId: string, userId: string): Promise<Outcome<Member[]>> {
    const name = this.store.exists() ? this.store.summary().name : "";
    const result = outcome(() => this.store.removeMember(actorId, userId));
    if (result.ok) {
      this.store.enqueue(`user:${userId}`, "forgetPlan", [this.planId, actorId === userId ? undefined : `You were removed from ${name}.`]);
      await this.schedule();
      await this.membersChanged({ removed: userId });
    }
    return result;
  }

  async removeDeletedAccount(userId: string) {
    if (!this.store.exists()) return;
    this.store.removeDeletedAccount(userId);
    await this.membersChanged({ removed: userId });
  }

  successors(departingId: string): string[] {
    return this.store.exists() ? this.store.successors(departingId) : [];
  }

  checkTransfer(ownerId: string, toUserId: string): Outcome<PlanSummary> {
    return outcome(() => this.store.checkTransfer(ownerId, toUserId));
  }

  async completeTransfer(fromId: string, toUserId: string, mode: "explicit" | "departing"): Promise<Outcome<Member[]>> {
    const result = outcome(() => this.store.completeTransfer(fromId, toUserId, mode));
    if (result.ok) await this.membersChanged({ owner: toUserId, ...(mode === "departing" ? { removed: fromId } : { roleChanged: fromId }) });
    return result;
  }

  ownerId(): string | null {
    return this.store.exists() ? this.store.ownerId() : null;
  }

  /** Hook for live sessions (sockets) to react to membership changes; live sessions use it. */
  protected async membersChanged(_change: { removed?: string; roleChanged?: string; owner?: string }) {}

  prepareDestroy(ownerId: string | null): Outcome<{ members: string[]; codes: string[]; name: string }> {
    return outcome(() => this.store.prepareDestroy(ownerId));
  }

  /** Deletes everything, the alarm included (compatibility date 2026-02-24 or later). */
  async destroy() {
    await this.closeAll(4004, "The plan was deleted.");
    await this.ctx.storage.deleteAll();
    // An empty schema, so later calls (a stray outbox message, an old link) answer "not found".
    this.store.reset();
  }

  protected async closeAll(_code: number, _reason: string) {}

  exportFor(userId: string): Outcome<{ content: PlanContent; name: string }> {
    return outcome(() => this.store.exportFor(userId));
  }

  memberRenamed(userId: string, displayName: string) {
    if (this.store.exists()) this.store.memberRenamed(userId, displayName);
  }

  // Links and invites

  createLink(userId: string, code: string, options: { access: "view" | "copy" | "invite"; role?: "editor" | "viewer"; expiresIn?: number | null; maxUses?: number }): Outcome<PlanLink> {
    return outcome(() => this.store.createLink(userId, code, options));
  }

  listLinks(userId: string): Outcome<PlanLink[]> {
    return outcome(() => this.store.listLinks(userId));
  }

  async revokeLink(userId: string, code: string, admin = false): Promise<Outcome<PlanLink>> {
    const result = outcome(() => this.store.revokeLink(userId, code, admin));
    if (result.ok) await this.linkClosed(code);
    return result;
  }

  async setLinkPaused(code: string, paused: boolean) {
    const link = this.store.setLinkPaused(code, paused);
    if (link && paused) await this.linkClosed(code);
    return link;
  }

  /** Closes anonymous sockets opened through a link (live sessions, below). */
  protected async linkClosed(_code: string) {}

  openLink(code: string, viewerId: string | null) {
    return outcome(() => this.store.openLink(code, viewerId));
  }

  exportForLink(code: string): Outcome<{ content: PlanContent; name: string }> {
    return outcome(() => this.store.exportForLink(code));
  }

  previewInvite(code: string) {
    return outcome(() => this.store.previewInvite(code));
  }

  async acceptInvite(code: string, user: { id: string; name: string }) {
    const result = outcome(() => this.store.acceptInvite(code, user));
    if (result.ok) await this.membersChanged({});
    return result;
  }

  /** Moderation: disables the plan for everyone but its owner, or re-enables it. */
  async setState(state: "active" | "disabled") {
    if (!this.store.exists()) return;
    this.store.setState(state);
    if (state === "disabled") await this.disabled();
  }

  protected async disabled() {}

  /** For the moderation queue: what was reported, without needing a link. */
  reviewSnapshot() {
    if (!this.store.exists()) return null;
    const snapshot = this.store.snapshot(null, { asLink: true });
    return { name: snapshot.doc.name, mapKey: snapshot.doc.mapKey, ownerId: this.store.ownerId(), notes: Object.values(snapshot.doc.notes).map((note) => ({ title: note.title, body: note.body })) };
  }
}
