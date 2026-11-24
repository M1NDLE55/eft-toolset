import type { RaidPlan } from "@/app/lib/raid-planner/types";
import { newOperationId, newRecordId } from "@/app/lib/sharing/ids";
import { keyBetween, compareOrder } from "@/app/lib/sharing/order-key";
import {
  applyOps,
  contentOf,
  diffPlan,
  docFromContent,
  entityRev,
  inverseOps,
  OpError,
  opTarget,
  toRaidPlan,
  withCurrentBases,
  type PlanDoc,
  type PlanOp,
} from "@/app/lib/sharing/plan-doc";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import type { Role } from "@/app/lib/sharing/types";
import type { PublicMember } from "@/app/lib/durable/plan-store";
import { PLAN_LIMITS } from "@/app/lib/durable/limits";
import type { AccountLibrary } from "./account-library";
import {
  deleteIssue,
  deletePlanCache,
  queueBatch,
  readIssues,
  readPlan,
  readQueue,
  replaceQueued,
  unqueueBatch,
  writePlan,
  type CachedPlan,
  type ConfirmedPlan,
  type PlanIssue,
  type QueuedBatch,
} from "./plan-cache";

/**
 * One account raid plan in the browser (§11.5, §12.8). It keeps the plan as PlanDO last confirmed it
 * and the user's queued batches; the editor shows the queue applied on top. Each user action is one
 * batch, sent one at a time; remote changes are applied to the confirmed state and the queue is
 * re-applied on top, so rebasing is just re-applying. The same session works offline: batches wait
 * in IndexedDB and replay later under the same rules.
 */

export interface Batch {
  rev: number;
  opId: string;
  actor: { id: string | null; name: string; via: "web" | "mcp"; client?: string };
  ops: PlanOp[];
}

export interface Snapshot {
  planId: string;
  rev: number;
  doc: PlanDoc;
  role: Role | "anonymous";
  allowCopy: boolean;
  state: "active" | "disabled";
  createdAt: number;
  updatedAt: number;
  members?: PublicMember[];
}

export type CatchUp = { batches: Batch[] } | { snapshot: Snapshot };

export type SendResult =
  | { kind: "ack"; rev: number; catchUp: CatchUp | null }
  | { kind: "reject"; code: "forbidden" | "gone" | "conflict" | "limit" | "invalid" | "rate_limited" | "not_found"; message: string; details?: Record<string, unknown> }
  | { kind: "offline" };

/** How a session talks to PlanDO: HTTP, or a live socket (live.ts). */
export interface PlanTransport {
  send(batch: QueuedBatch, knownRev: number): Promise<SendResult>;
  fetch(since: number | null): Promise<CatchUp | { lost: string } | null>;
  create?(content: PlanContent): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  close(): void;
}

export interface NoteConflict {
  batch: QueuedBatch;
  noteId: string;
  field: "title" | "body";
  mine: string;
  theirs: string;
  rev: number;
  byName: string;
  title: string;
}

export interface SessionView {
  ready: boolean;
  plan: RaidPlan | null;
  role: Role | null;
  readOnly: boolean;
  allowCopy: boolean;
  online: boolean;
  queued: number;
  syncedAt: number | null;
  issues: PlanIssue[];
  conflict: NoteConflict | null;
  offlineCopy: CachedPlan["offlineCopy"] | null;
  pendingCreate: boolean;
  members: PublicMember[];
  notices: { id: number; text: string }[];
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
}

const POLL_MS = 10_000;
const MAX_BACKOFF_MS = 60_000;

export class PlanSession {
  private confirmed: ConfirmedPlan | null = null;
  private queue: QueuedBatch[] = [];
  private issues: PlanIssue[] = [];
  private conflict: NoteConflict | null = null;
  private cached: CachedPlan | null = null;
  private listeners = new Set<() => void>();
  private notices: { id: number; text: string }[] = [];
  private undoStack: PlanOp[][] = [];
  private redoStack: PlanOp[][] = [];
  private localLayers: string[] | null = null;
  private online = true;
  private sending = false;
  private closed = false;
  private ready = false;
  private error: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1_000;
  private viewCache: { version: number; value: SessionView } | null = null;
  private version = 0;
  private seq = 0;
  transport: PlanTransport;

  constructor(
    readonly library: AccountLibrary,
    readonly planId: string,
    transport?: PlanTransport
  ) {
    this.transport = transport ?? httpTransport(library, planId);
  }

  private get db() {
    return this.library.database;
  }

  // Lifecycle

  async open({ poll = true }: { poll?: boolean } = {}) {
    // React may close and reopen the same session (strict mode in development).
    this.closed = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.cached = (await readPlan(this.db, this.planId)) ?? null;
    this.confirmed = this.cached?.state ?? null;
    this.queue = await readQueue(this.db, this.planId);
    this.issues = await readIssues(this.db, this.planId);
    this.seq = this.queue.at(-1)?.seq ?? 0;
    if (this.cached) await writePlan(this.db, { ...this.cached, openedAt: Date.now() });
    this.ready = this.confirmed !== null || this.cached?.offlineCopy !== undefined;
    this.notify();
    await this.refresh();
    this.ready = true;
    this.notify();
    void this.flush();
    if (poll && !this.closed) {
      this.pollTimer = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") void this.refresh();
      }, POLL_MS);
    }
  }

  /** What this user is editing, for presence (live sessions send it; otherwise nothing to do). */
  select(_target: string | null) {}

  close() {
    this.closed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.transport.close();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected notify() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private notice(text: string) {
    const id = Date.now() + Math.random();
    this.notices = [...this.notices, { id, text }].slice(-5);
    this.notify();
    setTimeout(() => {
      this.notices = this.notices.filter((notice) => notice.id !== id);
      this.notify();
    }, 8_000);
  }

  // State

  /** The confirmed document with the queue applied; a queued batch that no longer applies is skipped. */
  private display(): PlanDoc | null {
    if (!this.confirmed) return null;
    let doc = this.confirmed.doc;
    let rev = this.confirmed.rev;
    for (const batch of this.queue) {
      try {
        doc = applyOps(doc, batch.ops, { rev: (rev += 1), by: this.myKey() }).doc;
      } catch {
        // It will come back refused, and be listed then.
      }
    }
    return doc;
  }

  private myKey(): string | null {
    return this.confirmed?.members?.find((member) => member.you)?.key ?? null;
  }

  private memberName(key: string | null) {
    return this.confirmed?.members?.find((member) => member.key === key)?.displayName ?? "someone";
  }

  view(): SessionView {
    if (this.viewCache?.version === this.version) return this.viewCache.value;
    const doc = this.display();
    const role = this.confirmed?.role ?? (this.cached?.pendingCreate ? "owner" : null);
    let plan = doc && this.confirmed ? toRaidPlan(doc, this.planId, { createdAt: this.confirmed.createdAt, updatedAt: this.confirmed.updatedAt }) : null;
    if (plan && this.localLayers && role === "viewer") plan = { ...plan, enabledLayers: this.localLayers };
    const value: SessionView = {
      ready: this.ready,
      plan,
      role,
      readOnly: role !== "owner" && role !== "editor",
      allowCopy: this.confirmed?.allowCopy ?? false,
      online: this.online,
      queued: this.queue.length,
      syncedAt: this.confirmed?.syncedAt ?? null,
      issues: this.issues,
      conflict: this.conflict,
      offlineCopy: this.cached?.offlineCopy ?? null,
      pendingCreate: Boolean(this.cached?.pendingCreate),
      members: this.confirmed?.members ?? [],
      notices: this.notices,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      error: this.error,
    };
    this.viewCache = { version: this.version, value };
    return value;
  }

  // Editing

  /**
   * The editor's next plan, as one batch. Refused locally, with the server's message, when it would
   * break a cap; viewers can only change which layers they see.
   */
  edit(next: RaidPlan, options: { undoable?: boolean } = {}): string | null {
    const view = this.view();
    if (view.readOnly) {
      if (view.role === "viewer" && next.enabledLayers !== view.plan?.enabledLayers) {
        this.localLayers = next.enabledLayers;
        this.notify();
        return null;
      }
      return "You can view this plan, but not change it.";
    }
    const before = this.display();
    if (!before) return "This plan hasn't loaded yet.";
    const ops = diffPlan(before, next, newRecordId);
    if (ops.length === 0) return null;
    if (this.coalesceText(ops)) return null;
    const result = this.submitAll(ops, before);
    if (typeof result === "string") return result;
    if (options.undoable !== false) {
      this.undoStack = [...this.undoStack.slice(-49), inverseOps(before, result, newRecordId)];
      this.redoStack = [];
    }
    this.notify();
    return null;
  }

  /**
   * One user action is one batch, unless it has more than 50 ops (a whole layer group, a big undo):
   * then it goes as several batches in order. Caps are checked for the whole action first.
   */
  private submitAll(ops: PlanOp[], before: PlanDoc): PlanOp[] | string {
    try {
      applyOps(before, ops, { rev: (this.confirmed?.rev ?? 0) + this.queue.length + 1, by: this.myKey(), maxOps: Number.POSITIVE_INFINITY });
    } catch (error) {
      return error instanceof OpError ? error.message : "That change couldn't be made.";
    }
    const all: PlanOp[] = [];
    let doc = before;
    for (let start = 0; start < ops.length; start += PLAN_LIMITS.maxOpsPerBatch) {
      const chunk = ops.slice(start, start + PLAN_LIMITS.maxOpsPerBatch);
      const result = this.submit(chunk, doc);
      if (typeof result === "string") return result;
      all.push(...result);
      doc = this.display() ?? doc;
    }
    return all;
  }

  /**
   * Typing in a note sends a text op per keystroke; while the previous one for the same field is still
   * waiting (not in flight), it is updated instead, keeping its base. One undo step per edit session.
   */
  private coalesceText(ops: PlanOp[]): boolean {
    const [op] = ops;
    if (ops.length !== 1 || op.t !== "note.text") return false;
    const last = this.queue.at(-1);
    if (!last || (this.sending && last === this.queue[0]) || last.ops.length !== 1) return false;
    const previous = last.ops[0];
    if (previous.t !== "note.text" || previous.id !== op.id || previous.field !== op.field) return false;
    const limit = op.field === "title" ? 120 : 1000;
    if (op.value.length > limit) return false;
    const updated: QueuedBatch = { ...last, ops: [{ ...previous, value: op.value }] };
    this.queue = [...this.queue.slice(0, -1), updated];
    this.notify();
    void replaceQueued(this.db, updated).then(() => this.flush());
    return true;
  }

  /** Queues ops as one batch, after checking every cap against the current view. */
  private submit(ops: PlanOp[], before: PlanDoc): PlanOp[] | string {
    let normalized: PlanOp[];
    let after: PlanDoc;
    try {
      const applied = applyOps(before, ops, { rev: (this.confirmed?.rev ?? 0) + this.queue.length + 1, by: this.myKey() });
      normalized = applied.ops;
      after = applied.doc;
    } catch (error) {
      return error instanceof OpError ? error.message : "That change couldn't be made.";
    }
    const base: Record<string, number | null> = {};
    const touched: Record<string, unknown> = {};
    for (const op of normalized) {
      const target = opTarget(op);
      if (!target) continue;
      if (this.confirmed) base[target] = entityRev(this.confirmed.doc, target);
      const row = rowOf(after, target) ?? rowOf(before, target);
      if (row) touched[target] = row;
    }
    const batch: QueuedBatch = {
      planId: this.planId,
      seq: (this.seq += 1),
      opId: newOperationId(),
      ops: normalized,
      base,
      madeAtRev: this.confirmed?.rev ?? 0,
      after: touched,
      createdAt: Date.now(),
    };
    this.queue = [...this.queue, batch];
    this.notify();
    void queueBatch(this.db, batch).then(() => this.flush());
    return normalized;
  }

  /** Undo affects only this user's own changes (§11.5); a target someone else deleted is skipped. */
  undo() {
    this.step(this.undoStack, this.redoStack);
  }

  redo() {
    this.step(this.redoStack, this.undoStack);
  }

  private step(from: PlanOp[][], to: PlanOp[][]) {
    const entry = from.pop();
    const before = this.display();
    if (!entry || !before) return;
    const ops = withCurrentBases(before, entry).filter((op) => {
      const target = opTarget(op);
      if (!target || op.t.endsWith(".add")) return true;
      return entityRev(before, target) !== null;
    });
    if (ops.length === 0) {
      this.notice("Couldn't undo that: someone else changed or deleted it.");
      this.notify();
      return;
    }
    if (ops.length < entry.length) this.notice("Part of that was skipped: someone else deleted it.");
    const result = this.submitAll(ops, before);
    if (typeof result === "string") {
      this.notice(result);
      return;
    }
    to.push(inverseOps(before, result, newRecordId));
    this.notify();
  }

  // Sync

  /** Catches up from the confirmed rev (or loads the plan), unless offline. */
  async refresh() {
    try {
      if (this.cached?.pendingCreate && !this.confirmed?.syncedAt) {
        await this.flush();
        return;
      }
      const result = await this.transport.fetch(this.confirmed?.rev ?? null);
      if (result === null) throw new Error("offline");
      if ("lost" in result) {
        await this.loseAccess(result.lost);
        return;
      }
      await this.applyCatchUp(result);
      this.setOnline(true);
    } catch {
      this.setOnline(false);
    }
  }

  private setOnline(online: boolean) {
    if (this.online === online) return;
    this.online = online;
    this.notify();
  }

  /** Applies a snapshot or the batches after the confirmed rev; a gap means a fresh snapshot. */
  async applyCatchUp(catchUp: CatchUp) {
    if ("snapshot" in catchUp) {
      const snapshot = catchUp.snapshot;
      if (snapshot.role === "anonymous") return;
      this.confirmed = {
        rev: snapshot.rev,
        doc: snapshot.doc,
        role: snapshot.role,
        allowCopy: snapshot.allowCopy,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        members: snapshot.members,
        syncedAt: Date.now(),
      };
      // Batches the server already has (acked, but the answer was lost) are in the snapshot.
    } else {
      for (const batch of catchUp.batches) {
        if (!this.confirmed || batch.rev <= this.confirmed.rev) continue;
        if (batch.rev !== this.confirmed.rev + 1) {
          const fresh = await this.transport.fetch(null);
          if (fresh && !("lost" in fresh)) await this.applyCatchUp(fresh);
          return;
        }
        try {
          const doc = applyOps(this.confirmed.doc, batch.ops, { rev: batch.rev, by: batch.actor.id, maxOps: Number.POSITIVE_INFINITY }).doc;
          this.confirmed = { ...this.confirmed, rev: batch.rev, doc, updatedAt: Date.now(), syncedAt: Date.now() };
        } catch {
          const fresh = await this.transport.fetch(null);
          if (fresh && !("lost" in fresh)) await this.applyCatchUp(fresh);
          return;
        }
      }
    }
    await this.persistConfirmed();
    this.notify();
  }

  private async persistConfirmed() {
    if (!this.confirmed) return;
    this.cached = { ...(this.cached ?? { planId: this.planId }), state: this.confirmed, lostAccess: false };
    await writePlan(this.db, this.cached);
    void this.library.reloadPlans();
  }

  /** Remote ops from a live socket (live.ts). */
  async receive(batch: Batch) {
    await this.applyCatchUp({ batches: [batch] });
  }

  /** Sends the queue in order, one batch at a time, waiting for each answer (§12.8, replay step 3). */
  async flush() {
    if (this.sending || this.closed || this.conflict) return;
    this.sending = true;
    try {
      if (this.cached?.pendingCreate) {
        const created = await this.transport.create?.(this.cached.pendingCreate.content);
        if (!created) return;
        if (!created.ok) {
          if (created.code === "offline") return this.setOnline(false);
          this.error = `This plan couldn't be saved to your account: ${created.message}`;
          this.notify();
          return;
        }
        this.cached = { ...this.cached, pendingCreate: undefined };
        if (this.confirmed) this.confirmed = { ...this.confirmed, syncedAt: Date.now() };
        await this.persistConfirmed();
        this.error = null;
      }
      while (this.queue.length > 0 && !this.closed && !this.conflict && this.confirmed) {
        const batch = this.queue[0];
        if (batch.madeAtRev < this.confirmed.rev) this.reportOverwrites(batch);
        const result = await this.transport.send(batch, this.confirmed.rev);
        if (result.kind === "offline") {
          this.setOnline(false);
          this.scheduleRetry();
          return;
        }
        this.setOnline(true);
        this.backoff = 1_000;
        if (result.kind === "ack") {
          await this.acknowledge(batch, result);
          continue;
        }
        if (!(await this.handleReject(batch, result))) return;
      }
    } finally {
      this.sending = false;
      this.notify();
    }
  }

  private scheduleRetry(delay = this.backoff) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.refresh().then(() => this.flush());
    }, delay);
  }

  private async acknowledge(batch: QueuedBatch, result: Extract<SendResult, { kind: "ack" }>) {
    this.queue = this.queue.filter((queued) => queued.seq !== batch.seq);
    await unqueueBatch(this.db, this.planId, batch.seq);
    if (result.catchUp) {
      await this.applyCatchUp(result.catchUp);
    } else if (this.confirmed && result.rev === this.confirmed.rev + 1) {
      await this.applyCatchUp({ batches: [{ rev: result.rev, opId: batch.opId, actor: { id: this.myKey(), name: "", via: "web" }, ops: batch.ops }] });
    } else {
      const fresh = await this.transport.fetch(this.confirmed?.rev ?? null);
      if (fresh && !("lost" in fresh)) await this.applyCatchUp(fresh);
    }
  }

  /** Returns whether replay can go on with the next batch. */
  private async handleReject(batch: QueuedBatch, result: Extract<SendResult, { kind: "reject" }>): Promise<boolean> {
    const displayBefore = this.display();
    if (result.code === "rate_limited") {
      this.scheduleRetry(2_000);
      return false;
    }
    if (result.code === "not_found" || result.code === "forbidden" || (result.code === "gone" && !result.details?.id)) {
      await this.loseAccess(result.message);
      return false;
    }
    if (result.code === "conflict" && result.details?.field) {
      const details = result.details as { id: string; field: "title" | "body"; rev: number; value: string; byName?: string };
      const op = batch.ops.find((candidate) => candidate.t === "note.text" && candidate.id === details.id && candidate.field === details.field) as Extract<PlanOp, { t: "note.text" }> | undefined;
      this.conflict = {
        batch,
        noteId: details.id,
        field: details.field,
        mine: op?.value ?? "",
        theirs: details.value,
        rev: details.rev,
        byName: details.byName ?? "Someone",
        title: this.confirmed?.doc.notes[details.id]?.title ?? "",
      };
      this.notify();
      return false;
    }
    const kind = result.code === "gone" ? "gone" : result.code === "limit" ? "limit" : "invalid";
    const issue: PlanIssue = {
      planId: this.planId,
      opId: batch.opId,
      kind,
      message: kind === "gone" ? this.describeGone(batch, result.message) : result.message,
      ops: batch.ops,
      restore: kind === "gone" && displayBefore ? this.restoreOps(batch, displayBefore) : [],
      createdAt: Date.now(),
    };
    this.queue = this.queue.filter((queued) => queued.seq !== batch.seq);
    this.issues = [...this.issues, issue];
    await unqueueBatch(this.db, this.planId, batch.seq, issue);
    this.notify();
    return true;
  }

  private label(doc: PlanDoc | null, target: string) {
    const [kind, id] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
    if (!doc) return "an item";
    if (kind === "note") return `'${doc.notes[id]?.title || "a note"}'`;
    if (kind === "wp") {
      const index = Object.values(doc.waypoints).sort(compareOrder).findIndex((waypoint) => waypoint.id === id);
      return index >= 0 ? `waypoint ${index + 1}` : "a waypoint";
    }
    return "a drawing";
  }

  private describeGone(batch: QueuedBatch, fallback: string) {
    const target = batch.ops.map(opTarget).find((candidate) => candidate && this.confirmed && entityRev(this.confirmed.doc, candidate) === null);
    if (!target) return fallback;
    const previous = this.cachedDocBefore();
    return `You changed ${this.label(previous, target)}, which someone deleted.`;
  }

  private cachedDocBefore() {
    return this.cached?.state?.doc ?? null;
  }

  /**
   * "Add it back" (§12.8): fresh adds, with new ids, holding the items as the user last had them:
   * a waypoint at its offline position between its current neighbours, the drawing, or the note.
   */
  private restoreOps(batch: QueuedBatch, displayBefore: PlanDoc): PlanOp[] {
    if (!this.confirmed) return [];
    const current = this.confirmed.doc;
    const ops: PlanOp[] = [];
    for (const [target, value] of Object.entries(batch.after ?? {})) {
      if (entityRev(current, target) !== null || batch.ops.some((op) => opTarget(op) === target && op.t.endsWith(".del"))) continue;
      const row = (rowOf(displayBefore, target) ?? value) as Record<string, unknown>;
      const at = { x: row.x as number, z: row.z as number, ...(row.y === undefined ? {} : { y: row.y as number }) };
      if (target.startsWith("wp:")) {
        // Back where it was in the route, between whichever neighbours are still there.
        const ordered = Object.values(current.waypoints).sort(compareOrder);
        const ord = row.ord as string;
        const next = ordered.find((waypoint) => waypoint.ord > ord);
        const previous = ordered.findLast((waypoint) => waypoint.ord <= ord);
        ops.push({ t: "wp.add", id: newRecordId(), at, ord: keyBetween(previous?.ord ?? null, next?.ord ?? null) });
      } else if (target.startsWith("note:")) {
        ops.push({ t: "note.add", id: newRecordId(), at, title: row.title as string, body: row.body as string, color: row.color as string });
      } else if (target.startsWith("draw:")) {
        ops.push({ t: "draw.add", id: newRecordId(), kind: row.kind as "pen" | "arrow", color: row.color as string, points: row.points as PlanDoc["drawings"][string]["points"] });
      }
    }
    return ops;
  }

  /** "Your offline move of 'ZB-1011' replaced a newer change by <name>": nothing is overwritten silently. */
  private reportOverwrites(batch: QueuedBatch) {
    if (!this.confirmed) return;
    const reported = new Set<string>();
    for (const op of batch.ops) {
      const target = opTarget(op);
      if (!target || reported.has(target) || !(target in batch.base)) continue;
      const now = entityRev(this.confirmed.doc, target);
      if (now === null || now === batch.base[target]) continue;
      const [kind, id] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
      const row = kind === "wp" ? this.confirmed.doc.waypoints[id] : kind === "note" ? this.confirmed.doc.notes[id] : this.confirmed.doc.drawings[id];
      if (!row || row.by === this.myKey()) continue;
      reported.add(target);
      const verb = op.t.endsWith(".move") ? "move" : op.t === "note.text" ? "edit" : op.t.endsWith(".color") ? "colour change" : "change";
      this.notice(`Your offline ${verb} of ${this.label(this.confirmed.doc, target)} replaced a newer change by ${this.memberName(row.by)}.`);
    }
  }

  // Conflicts and issues

  /** The note clash prompt (§11.5): Keep mine re-sends on the new base; Keep theirs drops it; Keep both adds a note. */
  async resolveConflict(choice: "mine" | "theirs" | "both") {
    const conflict = this.conflict;
    if (!conflict) return;
    const others = conflict.batch.ops.filter((op) => !(op.t === "note.text" && op.id === conflict.noteId && op.field === conflict.field));
    let ops: PlanOp[] = others;
    if (choice === "mine") {
      ops = conflict.batch.ops.map((op) => (op.t === "note.text" && op.id === conflict.noteId && op.field === conflict.field ? { ...op, base: conflict.rev } : op));
    } else if (choice === "both") {
      const note = this.confirmed?.doc.notes[conflict.noteId];
      if (note) {
        ops = [
          ...others,
          {
            t: "note.add",
            id: newRecordId(),
            at: { x: note.x + 4, z: note.z + 4 },
            title: `${(conflict.field === "title" ? conflict.mine : note.title).slice(0, 107)} (my version)`,
            body: conflict.field === "body" ? conflict.mine : note.body,
            color: note.color,
          },
        ];
      }
    }
    this.conflict = null;
    this.queue = this.queue.filter((queued) => queued.seq !== conflict.batch.seq);
    await unqueueBatch(this.db, this.planId, conflict.batch.seq);
    const before = this.display();
    if (ops.length > 0 && before) {
      const result = this.submit(ops, before);
      if (typeof result === "string") this.notice(result);
    }
    this.notify();
    void this.flush();
  }

  async addBack(opId: string) {
    const issue = this.issues.find((candidate) => candidate.opId === opId);
    const before = this.display();
    if (!issue || !before || issue.restore.length === 0) return;
    const result = this.submit(issue.restore, before);
    if (typeof result === "string") {
      this.notice(result);
      return;
    }
    await this.dropIssue(opId);
  }

  async retryIssue(opId: string) {
    const issue = this.issues.find((candidate) => candidate.opId === opId);
    const before = this.display();
    if (!issue || !before) return;
    const result = this.submit(withCurrentBases(before, issue.ops), before);
    if (typeof result === "string") {
      this.notice(result);
      return;
    }
    await this.dropIssue(opId);
  }

  async dropIssue(opId: string) {
    this.issues = this.issues.filter((issue) => issue.opId !== opId);
    await deleteIssue(this.db, this.planId, opId);
    this.notify();
  }

  // Lost access (§12.8)

  /**
   * Access ended while edits were queued (removed, demoted, left elsewhere, plan deleted or disabled):
   * the edits can't apply, so the device keeps an offline copy of what the user last saw. If the plan
   * didn't allow copies and the user wasn't its owner, the copy keeps only what they added offline.
   */
  async loseAccess(reason: string) {
    const display = this.display();
    const hadEdits = this.queue.length > 0 || this.issues.length > 0;
    if (!hadEdits || !display || !this.confirmed) {
      await deletePlanCache(this.db, this.planId);
      this.cached = null;
      this.confirmed = null;
      this.error = reason || "You no longer have access to this plan.";
      this.notify();
      return;
    }
    const keepAll = this.confirmed.role === "owner" || this.confirmed.allowCopy;
    const doc = keepAll ? display : ownAdditions(display, this.queue);
    const copy = { doc, name: this.confirmed.doc.name, reason: reason || "You no longer have edit access to this plan.", createdAt: Date.now() };
    await deletePlanCache(this.db, this.planId);
    this.cached = { planId: this.planId, offlineCopy: copy };
    await writePlan(this.db, this.cached);
    this.confirmed = null;
    this.queue = [];
    this.issues = [];
    this.notify();
    void this.library.reloadPlans();
  }

  /** Save as my own plan: a new plan owned by the user, counted as a new plan. */
  async saveOfflineCopy(): Promise<{ ok: true; planId: string } | { ok: false; message: string }> {
    const copy = this.cached?.offlineCopy;
    if (!copy) return { ok: false, message: "There is no offline copy." };
    const content = { ...contentOf(copy.doc), name: `${copy.name.slice(0, 98)} (my offline copy)` };
    const response = await this.library.request("/api/plans", { method: "POST", body: JSON.stringify({ content, offlineCopy: true }) }).catch(() => null);
    if (!response) return { ok: false, message: "You're offline. Try again when you're connected." };
    const body = (await response.json()) as { planId?: string; error?: { message: string } };
    if (!response.ok || !body.planId) return { ok: false, message: body.error?.message ?? "It couldn't be saved." };
    await this.discardOfflineCopy();
    return { ok: true, planId: body.planId };
  }

  async discardOfflineCopy() {
    await deletePlanCache(this.db, this.planId);
    this.cached = null;
    this.notify();
    void this.library.reloadPlans();
  }

  offlineCopyContent(): PlanContent | null {
    const copy = this.cached?.offlineCopy;
    return copy ? { ...contentOf(copy.doc), name: copy.name } : null;
  }
}

function rowOf(doc: PlanDoc, target: string) {
  const id = target.slice(target.indexOf(":") + 1);
  if (target.startsWith("wp:")) return doc.waypoints[id];
  if (target.startsWith("note:")) return doc.notes[id];
  if (target.startsWith("draw:")) return doc.drawings[id];
  return undefined;
}

/** Only the items the user's queued batches added: what an offline copy of a copy-off plan keeps. */
export function ownAdditions(display: PlanDoc, queue: readonly QueuedBatch[]): PlanDoc {
  const added = new Set(queue.flatMap((batch) => batch.ops.filter((op) => op.t.endsWith(".add")).map((op) => opTarget(op)!)));
  const pick = <T,>(rows: Record<string, T>, kind: string) => Object.fromEntries(Object.entries(rows).filter(([id]) => added.has(`${kind}:${id}`)));
  return { name: display.name, mapKey: display.mapKey, layers: [], waypoints: pick(display.waypoints, "wp"), drawings: pick(display.drawings, "draw"), notes: pick(display.notes, "note") };
}

/** A new plan made in the account library: cached at once and created on the server when online (§12.8). */
export async function createAccountPlanLocally(library: AccountLibrary, content: PlanContent): Promise<string> {
  const db = library.database;
  const planId = newRecordId();
  const doc = docFromContent(content, null, 0);
  const now = Date.now();
  await writePlan(db, {
    planId,
    pendingCreate: { content: contentOf(doc) },
    state: { rev: 0, doc, role: "owner", allowCopy: false, createdAt: now, updatedAt: now, members: [], syncedAt: 0 },
  });
  await library.reloadPlans();
  return planId;
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
  return { code: body.error?.code ?? "invalid", message: body.error?.message ?? "Something went wrong.", details: body.error?.details };
}

/** Plans over HTTP: for clients without a socket, and for replaying queued plans in the background. */
export function httpTransport(library: AccountLibrary, planId: string): PlanTransport {
  return {
    async send(batch, knownRev) {
      let response: Response;
      try {
        response = await library.request(`/api/plans/${planId}/ops`, { method: "POST", body: JSON.stringify({ opId: batch.opId, ops: batch.ops, knownRev }) });
      } catch {
        return { kind: "offline" };
      }
      if (response.ok) {
        const body = (await response.json()) as { ack: { rev: number }; catchUp: CatchUp | null };
        return { kind: "ack", rev: body.ack.rev, catchUp: body.catchUp };
      }
      if (response.status >= 500) return { kind: "offline" };
      const error = await readError(response);
      return { kind: "reject", code: error.code as Extract<SendResult, { kind: "reject" }>["code"], message: error.message, details: error.details };
    },
    async fetch(since) {
      let response: Response;
      try {
        response = await library.request(`/api/plans/${planId}${since === null ? "" : `?since=${since}`}`);
      } catch {
        return null;
      }
      if (response.status === 404 || response.status === 410) return { lost: (await readError(response)).message };
      if (!response.ok) return null;
      return (await response.json()) as CatchUp;
    },
    async create(content) {
      let response: Response;
      try {
        response = await library.request("/api/plans", { method: "POST", body: JSON.stringify({ id: planId, content }) });
      } catch {
        return { ok: false, code: "offline", message: "You're offline." };
      }
      if (response.ok) return { ok: true };
      const error = await readError(response);
      // Already created (a lost answer): the id is ours if we are its owner.
      if (error.details?.reason === "id_taken") {
        const check = await library.request(`/api/plans/${planId}`).catch(() => null);
        if (check?.ok) return { ok: true };
      }
      return { ok: false, code: error.code, message: error.message };
    },
    close() {},
  };
}
