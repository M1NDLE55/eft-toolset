import { DurableObject } from "cloudflare:workers";
import type { BucketLimit, RequestBudget } from "@/app/lib/api/rate-limit-store";
import type { FeedMessage, LibraryRecord, Mutation, MutationResult, Origin, Role } from "@/app/lib/sharing/types";
import { USER_LIMITS, type UserRate } from "./limits";
import { outcome, outcomeAsync, type Outcome } from "./outcome";
import { drainOutbox } from "./outbox";
import type { Sql } from "./sql";
import { UserStore, type LinkRow, type LinkSnapshot, type PlanSummary } from "./user-store";

/** The header the Worker sets on a change-feed upgrade: the device the socket belongs to. */
export const DEVICE_HEADER = "X-EFT-Device";

interface DeviceAttachment {
  deviceId: string;
  connectedAt: number;
}

/**
 * One per user, named by their WorkOS user id. The Worker authenticates the caller and only ever
 * reaches the caller's own object, so every method here acts as that user. Holds the user's library
 * (UserStore), pushes changes to their open devices over hibernatable WebSockets (the change feed,
 * §12.6), and runs an alarm for housekeeping and the outbox.
 */
export class UserDO extends DurableObject<Env> {
  private readonly store: UserStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new UserStore(ctx.storage.sql as unknown as Sql, (work) => ctx.storage.transactionSync(work));
    void ctx.blockConcurrencyWhile(async () => {
      this.store.migrate();
    });
    // Heartbeats are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private get userId(): string {
    const name = this.ctx.id.name ?? this.store.profile()?.userId;
    if (!name) throw new Error("UserDO reached without a name.");
    return name;
  }

  private ensure() {
    this.store.ensureProfile(this.userId);
  }

  /** Runs a change, then pushes whatever it changed to the user's devices and re-arms the alarm. */
  private async changing<T>(work: () => T, originMutationIds: (value: T) => string[] = () => []): Promise<T> {
    this.ensure();
    const before = this.store.seq();
    const value = work();
    if (this.store.seq() !== before) this.broadcastSince(before, originMutationIds(value));
    await this.schedule();
    return value;
  }

  private broadcastSince(since: number, originMutationIds: string[]) {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const changes = this.store.changesSince(since);
    const message: FeedMessage = changes.resync
      ? { type: "resync" }
      : { type: "changes", seq: changes.seq, records: changes.records, tombstones: changes.tombstones, originMutationIds };
    const text = JSON.stringify(message);
    for (const socket of sockets) {
      try {
        socket.send(text);
      } catch {
        // A socket that is closing is cleaned up by webSocketClose.
      }
    }
  }

  private async schedule() {
    const due = this.store.nextDue();
    if (due === null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > due) await this.ctx.storage.setAlarm(Math.max(due, Date.now() + 1_000));
  }

  async alarm() {
    if (this.store.isDeleting()) {
      // Resume an account deletion that failed partway (§14.4).
      const { runAccountDeletion } = await import("@/app/lib/sharing/server/account-deletion");
      await runAccountDeletion(this.env as never, this.userId);
      return;
    }
    this.store.sweep();
    await drainOutbox(this.env, this.store);
    await this.schedule();
  }

  /** A deletion step failed: try again in a minute, with the alarm. */
  async retryDeletionLater() {
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
  }

  // Budgets (MCP) and rates

  chargeBudget(key: string, limit: BucketLimit, cost: number, refundOnDenial: number): RequestBudget {
    return this.store.chargeBudget(key, limit, cost, refundOnDenial);
  }

  charge(rate: UserRate, cost = 1): Outcome<null> {
    return outcome(() => {
      this.store.charge(rate, cost);
      return null;
    });
  }

  // Profile and snapshot

  profile() {
    this.ensure();
    return this.store.profile();
  }

  displayName() {
    this.ensure();
    return this.store.displayName();
  }

  async setDisplayName(name: string): Promise<Outcome<string>> {
    this.ensure();
    const result = outcome(() => this.store.setDisplayName(name));
    if (result.ok) {
      // Co-members see the new name: each plan caches it on its member row.
      for (const plan of this.store.plans()) this.store.enqueue(`plan:${plan.id}`, "memberRenamed", [this.userId, result.value]);
      await this.schedule();
    }
    return result;
  }

  library() {
    this.ensure();
    return this.store.library();
  }

  changesSince(since: number) {
    this.ensure();
    return this.store.changesSince(since);
  }

  record(kind: LibraryRecord["kind"], id: string) {
    this.ensure();
    return this.store.record(kind, id);
  }

  async applyMutations(mutations: Mutation[], origin: Origin = "created"): Promise<Outcome<MutationResult[]>> {
    return outcomeAsync(() =>
      this.changing(
        () => this.store.applyMutations(mutations, origin),
        (list) => list.filter((result) => result.status === "applied").map((result) => result.mutationId)
      )
    );
  }

  async setAllowCopy(kind: "build" | "item_group", id: string, allowCopy: boolean): Promise<Outcome<LibraryRecord>> {
    return outcomeAsync(() => this.changing(() => this.store.setAllowCopy(kind, id, allowCopy)));
  }

  async importItem(item: { type: "build" | "item_group"; id: string; value: unknown }, origin: "migration" | "restore") {
    return outcomeAsync(() => this.changing(() => this.store.importItem(item, origin)));
  }

  async createCopy(kind: "build" | "item_group", id: string, value: unknown, copiedFrom: string, rate: UserRate | null = "acceptsAndCopies") {
    return outcomeAsync(() => this.changing(() => this.store.createCopy(kind, id, value, copiedFrom, rate)));
  }

  markNoticesRead(ids: number[]) {
    this.store.markNoticesRead(ids);
  }

  // Links to builds and item groups

  createLink(code: string, target: { type: "build" | "item_group"; id: string }, access: "view" | "copy", expiresInDays: number | null): Outcome<LinkRow> {
    this.ensure();
    return outcome(() => this.store.createLink(code, target, access, expiresInDays));
  }

  listLinks(type: "build" | "item_group", id: string): LinkRow[] {
    return this.store.listLinks(type, id);
  }

  async revokeLink(code: string, admin = false): Promise<Outcome<LinkRow>> {
    const result = outcome(() => this.store.revokeLink(code, admin));
    return result;
  }

  openLink(code: string, asOwner = false): Outcome<LinkSnapshot> {
    return outcome(() => this.store.openLink(code, { count: !asOwner, asOwner }));
  }

  exportForLink(code: string): Outcome<LinkSnapshot> {
    return outcome(() => this.store.exportForLink(code));
  }

  link(code: string) {
    return this.store.link(code);
  }

  setLinkPaused(code: string, paused: boolean) {
    const link = this.store.setLinkPaused(code, paused);
    if (link && paused) this.store.addNotice("moderation", "A link to one of your items was paused after reports. It shows as under review until it is checked.");
    return link;
  }

  setItemState(kind: "build" | "item_group", id: string, state: "active" | "disabled") {
    this.store.setItemState(kind, id, state);
    if (state === "disabled") this.store.addNotice("moderation", "One of your shared items was removed from its links after review.");
  }

  addNotice(kind: string, body: string) {
    this.ensure();
    const notice = this.store.addNotice(kind, body);
    const text = JSON.stringify({ type: "notice", notice } satisfies FeedMessage);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(text);
      } catch {
        // closing
      }
    }
  }

  // Plan index (PlanDO is the authority; see access.ts for the reserve, act, confirm flow)

  plans() {
    this.ensure();
    return this.store.plans();
  }

  planEntry(planId: string) {
    return this.store.planEntry(planId);
  }

  async reservePlan(planId: string, options: Parameters<UserStore["reservePlan"]>[1]) {
    this.ensure();
    const result = outcome(() => this.store.reservePlan(planId, options));
    await this.schedule();
    return result;
  }

  async confirmPlan(planId: string, summary: PlanSummary) {
    return this.changing(() => this.store.confirmPlan(planId, summary));
  }

  releasePlan(planId: string) {
    this.store.releasePlan(planId);
  }

  async reserveShared(planId: string) {
    this.ensure();
    const result = outcome(() => this.store.reserveShared(planId));
    await this.schedule();
    return result;
  }

  async setPlanEntry(planId: string, entry: { role: Role; summary?: Partial<PlanSummary> }) {
    return this.changing(() => this.store.setPlanEntry(planId, entry));
  }

  async receiveOwnership(planId: string, summary: Partial<PlanSummary>, notice: string | null) {
    return outcomeAsync(() => this.changing(() => this.store.receiveOwnership(planId, summary, notice)));
  }

  async touchPlan(planId: string, summary: Partial<PlanSummary> & { role?: Role }) {
    await this.changing(() => this.store.touchPlan(planId, summary));
  }

  async forgetPlan(planId: string, notice?: string) {
    await this.changing(() => this.store.forgetPlan(planId, notice));
  }

  pendingPlans() {
    return this.store.pendingPlans();
  }

  planIds(relation: "owned" | "shared") {
    return this.store.planIds(relation);
  }

  usage() {
    return this.store.usage();
  }

  isDeleting() {
    return this.store.isDeleting();
  }

  async enqueue(target: string, method: string, args: unknown[]) {
    this.store.enqueue(target, method, args);
    await this.schedule();
  }

  // Account deletion (§14.4): steps are recorded so the flow can resume after a failure.

  beginDeletion() {
    this.ensure();
    this.store.beginDeletion();
  }

  deletionStepDone(step: string) {
    return this.store.deletionStepDone(step);
  }

  markDeletionStep(step: string) {
    this.store.markDeletionStep(step);
  }

  deleteLibraryContent() {
    return this.store.deleteLibraryContent();
  }

  /** The last step: the object's storage and its alarm are gone (compatibility date 2026-02-24+). */
  async wipe() {
    for (const socket of this.ctx.getWebSockets()) socket.close(4003, "Account deleted.");
    await this.ctx.storage.deleteAll();
    // An empty schema, so a stray message finds no data rather than a missing table.
    this.store.migrate();
  }

  // Change feed

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket.", { status: 426 });
    this.ensure();
    const deviceId = (request.headers.get(DEVICE_HEADER) ?? "").slice(0, 64) || "device";
    const since = Number(new URL(request.url).searchParams.get("since") ?? "-1");
    // At most 10 sockets per user: the oldest is closed.
    const open = this.ctx
      .getWebSockets()
      .map((socket) => ({ socket, attachment: socket.deserializeAttachment() as DeviceAttachment | null }))
      .sort((a, b) => (a.attachment?.connectedAt ?? 0) - (b.attachment?.connectedAt ?? 0));
    for (const { socket } of open.slice(0, Math.max(0, open.length - USER_LIMITS.deviceSockets + 1))) {
      socket.close(4008, "Too many devices connected.");
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [`device:${deviceId}`]);
    server.serializeAttachment({ deviceId, connectedAt: Date.now() } satisfies DeviceAttachment);
    const changes = this.store.changesSince(since);
    const first: FeedMessage = changes.resync
      ? { type: "resync" }
      : { type: "changes", seq: changes.seq, records: changes.records, tombstones: changes.tombstones, originMutationIds: [] };
    server.send(JSON.stringify(first));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The feed is server to client only; anything a device sends (other than ping) is ignored. */
  async webSocketMessage() {}

  async webSocketClose() {
    // From compatibility date 2026-04-07 the runtime answers the close frame itself.
  }
}
