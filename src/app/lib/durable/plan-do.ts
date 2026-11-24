import { DurableObject } from "cloudflare:workers";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import { opTarget, type PlanOp } from "@/app/lib/sharing/plan-doc";
import { PLAN_LIMITS, PLAN_SOCKET_RATES } from "./limits";
import type { ClientMessage, Presence, RejectCode, ServerMessage, SocketInfo } from "./live-protocol";
import { MAX_SOCKET_MESSAGE } from "./live-protocol";
import type { Role } from "@/app/lib/sharing/types";
import { outcome, type Outcome } from "./outcome";
import { drainOutbox } from "./outbox";
import { memberKey, PlanStore, type Actor, type Batch, type Member, type PlanLink, type PlanSnapshot, type PlanSummary, type PublicMember } from "./plan-store";

/** Headers the Worker sets on a live upgrade after checking the caller; any copy the client sent is removed. */
export const PLAN_ACTOR_HEADER = "X-EFT-Actor";
export const PLAN_LINK_HEADER = "X-EFT-Link";
const AGENT_PRESENCE_MS = 60_000;
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
  protected async afterApply(result: { rev: number; ops: PlanOp[]; duplicate: boolean; renamed: boolean }, actor: Actor & { id: string }, opId: string, sender?: WebSocket) {
    if (result.duplicate) return;
    const key = memberKey(this.planId, actor.id);
    if (actor.via === "mcp") {
      // Agents have no socket: they show in presence for a minute after each edit (§11.2).
      const target = result.ops.map((op) => opTarget(op)).find(Boolean) ?? null;
      this.agents.set(key, { key, name: this.store.memberName(actor.id), role: this.store.role(actor.id) ?? "editor", via: "mcp", client: actor.client, editing: target, floor: null, expiresAt: Date.now() + AGENT_PRESENCE_MS });
    }
    const message = JSON.stringify({ type: "ops", rev: result.rev, opId, actor: { id: key, name: this.store.memberName(actor.id), via: actor.via, ...(actor.client ? { client: actor.client } : {}) }, ops: result.ops });
    for (const socket of this.ctx.getWebSockets()) if (socket !== sender) this.sendRaw(socket, message);
    if (result.renamed) this.broadcastSettings();
    if (actor.via === "mcp") this.broadcastPresence();
    this.store.queueSummary(result.renamed);
    await this.schedule();
  }

  // Settings and members

  async setAllowCopy(userId: string, allowCopy: boolean): Promise<Outcome<{ allowCopy: boolean; name: string }>> {
    const result = outcome(() => this.store.setAllowCopy(userId, allowCopy));
    if (result.ok) this.broadcastSettings();
    return result;
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

  /**
   * After a membership change: a removed member's sockets close (4003), a member whose role changed
   * reconnects for a fresh snapshot (4009), a new owner is told, and everyone gets the member list.
   */
  protected async membersChanged(change: { removed?: string; roleChanged?: string; owner?: string }) {
    if (change.removed) for (const socket of this.ctx.getWebSockets(`user:${change.removed}`)) this.end(socket, 4003, "You were removed from this plan.");
    if (change.roleChanged) for (const socket of this.ctx.getWebSockets(`user:${change.roleChanged}`)) this.end(socket, 4009, "Your role changed.");
    if (change.owner) {
      const notice = JSON.stringify({ type: "notice", kind: "ownership", message: `You now own ${this.store.summary().name}.` });
      for (const socket of this.ctx.getWebSockets(`user:${change.owner}`)) this.sendRaw(socket, notice);
      for (const socket of this.ctx.getWebSockets(`user:${change.owner}`)) this.end(socket, 4009, "Your role changed.");
    }
    if (!this.store.exists()) return;
    for (const socket of this.ctx.getWebSockets()) {
      const info = this.info(socket);
      if (info?.userId) this.sendRaw(socket, JSON.stringify({ type: "members", members: this.store.publicMembers(info.userId) }));
    }
    this.broadcastPresence();
  }

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

  protected async closeAll(code: number, reason: string) {
    for (const socket of this.ctx.getWebSockets()) this.end(socket, code, reason);
  }

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

  /** Anonymous sockets opened through a revoked, expired or paused view link close at once (§7.5). */
  protected async linkClosed(code: string) {
    for (const socket of this.ctx.getWebSockets(`link:${code}`)) this.end(socket, 4010, "This link no longer works.");
    this.broadcastPresence();
  }

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

  /** Moderation: only the owner keeps their sockets. */
  protected async disabled() {
    const owner = this.store.ownerId();
    for (const socket of this.ctx.getWebSockets()) {
      const info = this.info(socket);
      if (info?.userId !== owner) this.end(socket, info?.userId ? 4003 : 4010, "This plan was removed after review.");
    }
  }

  /** For the moderation queue: what was reported, without needing a link. */
  reviewSnapshot() {
    if (!this.store.exists()) return null;
    const snapshot = this.store.snapshot(null, { asLink: true });
    return { name: snapshot.doc.name, mapKey: snapshot.doc.mapKey, ownerId: this.store.ownerId(), notes: Object.values(snapshot.doc.notes).map((note) => ({ title: note.title, body: note.body })) };
  }
  // Live sessions (§11): hibernatable WebSockets. Nothing live is kept in memory that can't be rebuilt
  // from the sockets' attachments, except agent presence, which is lost on hibernation by design.

  private agents = new Map<string, Presence & { expiresAt: number }>();

  private info(socket: WebSocket): SocketInfo | null {
    try {
      return socket.deserializeAttachment() as SocketInfo | null;
    } catch {
      return null;
    }
  }

  /**
   * Ends a session: a last "closing" message with the code, then the close. Clients act on the
   * message at once; the close event itself can lag behind on some proxies.
   */
  private end(socket: WebSocket, code: number, reason: string) {
    this.sendRaw(socket, JSON.stringify({ type: "closing", code, reason }));
    socket.close(code, reason);
  }

  private sendRaw(socket: WebSocket, message: string) {
    try {
      socket.send(message);
    } catch {
      // Closing; webSocketClose cleans up.
    }
  }

  private send(socket: WebSocket, message: ServerMessage) {
    this.sendRaw(socket, JSON.stringify(message));
  }

  /**
   * Upgrades a live connection. The Worker has checked the session or link code's MAC and the
   * Origin, and passes who it is in a header; this checks membership (or the link's state) and the
   * socket caps, then sends a snapshot or the ops since `since`.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket.", { status: 426 });
    if (!this.store.exists()) return new Response("Not found", { status: 404 });
    const actorId = request.headers.get(PLAN_ACTOR_HEADER);
    const linkCode = request.headers.get(PLAN_LINK_HEADER);
    const since = Number(new URL(request.url).searchParams.get("since") ?? "-1");
    let info: SocketInfo;
    const now = Date.now();
    const buckets = { batches: { tokens: PLAN_SOCKET_RATES.batches.burst, at: now }, previews: { tokens: PLAN_SOCKET_RATES.previews.burst, at: now }, strikes: 0 };
    if (actorId) {
      const role = this.store.role(actorId);
      if (!role) return new Response("Not found", { status: 404 });
      if (this.store.state() === "disabled" && role !== "owner") return new Response("Gone", { status: 410 });
      // At most 5 sockets per member: the oldest closes.
      const mine = this.ctx
        .getWebSockets(`user:${actorId}`)
        .map((socket) => ({ socket, info: this.info(socket) }))
        .sort((a, b) => (a.info?.connectedAt ?? 0) - (b.info?.connectedAt ?? 0));
      for (const { socket } of mine.slice(0, Math.max(0, mine.length - PLAN_LIMITS.socketsPerMember + 1))) this.end(socket, 4008, "Opened somewhere else.");
      info = { connId: crypto.randomUUID(), userId: actorId, key: memberKey(this.planId, actorId), role, link: null, name: this.store.memberName(actorId), editing: null, floor: null, connectedAt: now, ...buckets };
    } else if (linkCode) {
      try {
        this.store.checkViewLink(linkCode, null);
      } catch (error) {
        const code = (error as { code?: string }).code;
        return new Response(error instanceof Error ? error.message : "Not found", { status: code === "gone" ? 410 : code === "forbidden" ? 403 : 404 });
      }
      // Past 200 anonymous viewers, more fall back to polling the cached snapshot (§9.3).
      if (this.ctx.getWebSockets("anon").length >= PLAN_LIMITS.anonymousSockets) return new Response("Busy", { status: 429, headers: { "Retry-After": "15" } });
      info = { connId: crypto.randomUUID(), userId: null, key: null, role: "anonymous", link: linkCode, name: "", editing: null, floor: null, connectedAt: now, ...buckets };
    } else {
      return new Response("Unauthenticated", { status: 401 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    const tags = info.userId ? [`user:${info.userId}`, `role:${info.role}`] : ["anon", `link:${info.link}`];
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment(info);
    this.sendFirst(server, info, since);
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The first message: the ops after `since` if the log still has them, otherwise a snapshot. */
  private sendFirst(socket: WebSocket, info: SocketInfo, since: number) {
    const batches = since >= 0 ? this.store.opsSince(since) : null;
    if (batches) {
      for (const batch of batches) this.send(socket, { type: "ops", rev: batch.rev, opId: batch.opId, actor: batch.actor, ops: batch.ops });
      this.send(socket, { type: "caught-up", rev: this.store.summary().rev });
      if (info.userId) this.send(socket, { type: "members", members: this.store.publicMembers(info.userId) });
      return;
    }
    const snapshot = this.store.snapshot(info.userId, { asLink: !info.userId });
    const doc = info.userId ? snapshot.doc : anonymousDoc(snapshot.doc);
    this.send(socket, {
      type: "snapshot",
      rev: snapshot.rev,
      doc,
      you: { role: info.role, key: info.key },
      settings: { allowCopy: snapshot.allowCopy, name: snapshot.doc.name },
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      ...(info.userId ? { members: snapshot.members } : {}),
      ...this.presenceFor(info),
    });
  }

  private presence(): Presence[] {
    const now = Date.now();
    const byKey = new Map<string, Presence>();
    for (const socket of this.ctx.getWebSockets()) {
      const info = this.info(socket);
      if (!info?.key) continue;
      const existing = byKey.get(info.key);
      if (!existing || (info.editing && !existing.editing)) {
        byKey.set(info.key, { key: info.key, name: info.name, role: info.role as Role, via: "web", editing: info.editing, floor: info.floor });
      }
    }
    for (const [key, agent] of this.agents) {
      if (agent.expiresAt < now) this.agents.delete(key);
      else if (!byKey.has(`${key}:mcp`)) byKey.set(`${key}:mcp`, { key: agent.key, name: agent.name, role: agent.role, via: "mcp", client: agent.client, editing: agent.editing, floor: null });
    }
    return [...byKey.values()];
  }

  /** Who is here now, for list_raid_plan_members. */
  presenceNow(): { presence: Presence[]; anonymous: number } {
    return { presence: this.presence(), anonymous: this.ctx.getWebSockets("anon").length };
  }

  private presenceFor(info: SocketInfo) {
    const anonymous = this.ctx.getWebSockets("anon").length;
    if (info.userId) return { presence: this.presence(), anonymous };
    // Anonymous viewers see only how many people are here (§8.1).
    return { presence: [] as Presence[], anonymous, online: new Set(this.presence().map((entry) => entry.key)).size };
  }

  private broadcastPresence() {
    let members: string | null = null;
    for (const socket of this.ctx.getWebSockets()) {
      const info = this.info(socket);
      if (!info) continue;
      if (info.userId) {
        members ??= JSON.stringify({ type: "presence", ...this.presenceFor(info) });
        this.sendRaw(socket, members);
      } else {
        this.send(socket, { type: "presence", ...this.presenceFor(info) });
      }
    }
  }

  private broadcastSettings() {
    if (!this.store.exists()) return;
    const snapshot = this.store.snapshot(null, { asLink: true });
    const message = JSON.stringify({ type: "settings", allowCopy: snapshot.allowCopy, name: snapshot.doc.name });
    for (const socket of this.ctx.getWebSockets()) this.sendRaw(socket, message);
  }

  /** Token bucket per socket, kept in its attachment so it survives hibernation. */
  private take(info: SocketInfo, bucket: "batches" | "previews"): boolean {
    const limit = PLAN_SOCKET_RATES[bucket];
    const now = Date.now();
    const state = info[bucket];
    state.tokens = Math.min(limit.burst, state.tokens + ((now - state.at) / 1000) * limit.refillPerSecond);
    state.at = now;
    if (state.tokens < 1) return false;
    state.tokens -= 1;
    return true;
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const info = this.info(socket);
    if (!info || typeof message !== "string") return;
    if (message.length > MAX_SOCKET_MESSAGE) {
      socket.close(1009, "Message too large.");
      return;
    }
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }
    if (parsed.type === "presence") {
      info.editing = typeof parsed.editing === "string" ? parsed.editing.slice(0, 80) : null;
      info.floor = typeof parsed.floor === "string" ? parsed.floor.slice(0, 80) : null;
      socket.serializeAttachment(info);
      this.broadcastPresence();
      return;
    }
    if (parsed.type !== "ops" && parsed.type !== "preview") return;
    const role = info.userId ? this.store.role(info.userId) : null;
    const opId = parsed.type === "ops" ? String(parsed.opId ?? "") : "";
    if (role !== "owner" && role !== "editor") {
      if (parsed.type === "ops") this.send(socket, { type: "reject", opId, code: "forbidden", message: role === "viewer" ? "Viewers can't change this plan." : "You can't change this plan." });
      return;
    }
    if (!this.take(info, parsed.type === "ops" ? "batches" : "previews")) {
      info.strikes += 1;
      socket.serializeAttachment(info);
      if (info.strikes > 20) this.end(socket, 4008, "Too many changes too quickly.");
      else if (parsed.type === "ops") this.send(socket, { type: "reject", opId, code: "rate_limited", message: "Too many changes too quickly." });
      return;
    }
    socket.serializeAttachment(info);
    if (parsed.type === "preview") {
      // A drag in progress: shown to others, never stored. Moves only.
      if (!Array.isArray(parsed.ops) || parsed.ops.length > 5) return;
      const ops = parsed.ops.filter((op) => op && (op.t === "wp.move" || op.t === "note.move"));
      if (ops.length === 0) return;
      const text = JSON.stringify({ type: "preview", actor: { id: info.key, name: info.name, via: "web" }, ops });
      for (const other of this.ctx.getWebSockets()) if (other !== socket) this.sendRaw(other, text);
      return;
    }
    const actor = { id: info.userId!, name: info.name, via: "web" as const };
    const result = outcome(() => this.applyBatch(actor, opId, Array.isArray(parsed.ops) ? parsed.ops : []));
    if (!result.ok) {
      this.send(socket, { type: "reject", opId, code: result.error.code as RejectCode, message: result.error.message, details: result.error.details });
      return;
    }
    this.send(socket, { type: "ack", opId, rev: result.value.rev });
    await this.afterApply(result.value, actor, opId, socket);
  }

  async webSocketClose() {
    // The runtime answers the close frame itself (compatibility date 2026-04-07 or later).
    this.broadcastPresence();
  }

  async webSocketError() {
    this.broadcastPresence();
  }
}

/** Anonymous viewers don't learn who changed what. */
function anonymousDoc(doc: PlanSnapshot["doc"]): PlanSnapshot["doc"] {
  const strip = <T extends { by: string | null }>(rows: Record<string, T>) => Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, { ...row, by: null }]));
  return { ...doc, waypoints: strip(doc.waypoints), drawings: strip(doc.drawings), notes: strip(doc.notes) };
}
