import { newOperationId, newRecordId } from "@/app/lib/sharing/ids";
import type {
  BuildValue,
  ChangesResult,
  FeedMessage,
  GroupValue,
  LibraryRecord,
  LibrarySnapshot,
  Mutation,
  MutationResult,
  Notice,
  Patch,
  PlanIndexRecord,
  RecordKind,
  Usage,
} from "@/app/lib/sharing/types";
import { openAccountDb, readAll, readMeta, transact } from "./idb";
import { readAllPlans, type CachedPlan } from "./plan-cache";
import {
  actionFor,
  applyMutationLocally,
  clashesWith,
  diffRecords,
  foldQueue,
  rebase,
  recordKey,
  remoteChangedFields,
  stripRecord,
  type CachedRecord,
  type QueueEntry,
} from "./library-cache";

/**
 * The signed-in user's library in this browser (§12): an IndexedDB cache the UI reads, written
 * optimistically, with a queue of mutations replayed to the server. One tab per account is the sync
 * leader (Web Locks): it holds the change-feed socket and drains the queue. Every tab hears about
 * changes on a BroadcastChannel and re-reads the cache.
 */

interface StoredQueueEntry extends QueueEntry {
  seq: number;
  /** Sent to the server as is; replayed unchanged until acknowledged, so its mutation id stays the same. */
  sent?: boolean;
}

type ChannelMessage =
  | { type: "records"; keys: string[] }
  | { type: "plans"; planIds: string[] }
  | { type: "queue" }
  | { type: "conflict"; key: string }
  | { type: "signed-out" };

export interface SyncStatus {
  online: boolean;
  queued: number;
  syncing: boolean;
  lastSyncedAt: number | null;
  conflicts: number;
  problems: number;
}

const BATCH_SIZE = 50;
const MAX_BACKOFF_MS = 60_000;
const PING_INTERVAL_MS = 30_000;

export class AccountLibrary {
  private db: IDBDatabase | null = null;
  private records = new Map<string, CachedRecord>();
  private planIndex = new Map<string, PlanIndexRecord>();
  private listeners = new Set<() => void>();
  private noticeListeners = new Set<(notice: Notice) => void>();
  private channel: BroadcastChannel | null = null;
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1_000;
  private leader = false;
  private releaseLock: (() => void) | null = null;
  private draining = false;
  private closed = false;
  private seq = 0;
  private deviceId = "";
  private queueCount = 0;
  private version = 0;
  private snapshotCache: { version: number; value: LibraryView } | null = null;
  private cachedPlans: CachedPlanSummary[] = [];
  private planSyncing = false;
  status: SyncStatus = { online: true, queued: 0, syncing: false, lastSyncedAt: null, conflicts: 0, problems: 0 };
  usage: Usage | null = null;
  limits: Usage | null = null;
  displayName = "";
  notices: Notice[] = [];
  ready = false;

  constructor(readonly cacheKey: string) {}

  /** The open account cache. */
  get database(): IDBDatabase {
    if (!this.db) throw new Error("Your account library is still loading.");
    return this.db;
  }

  // Lifecycle

  async open() {
    this.db = await openAccountDb(this.cacheKey);
    this.deviceId = (await readMeta<string>(this.db, "deviceId")) ?? newOperationId();
    this.seq = (await readMeta<number>(this.db, "seq")) ?? -1;
    await transact(this.db, ["meta"], "readwrite", (tx) => tx.objectStore("meta").put(this.deviceId, "deviceId"));
    await this.reload();
    this.ready = true;
    this.notify();
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`eft-toolset:account:${this.cacheKey}`);
      this.channel.onmessage = (event: MessageEvent<ChannelMessage>) => void this.onChannel(event.data);
    }
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    this.status = { ...this.status, online: navigator.onLine !== false };
    this.becomeLeaderWhenPossible();
  }

  close() {
    this.closed = true;
    this.releaseLock?.();
    this.dropSocket();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.channel?.close();
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    this.db?.close();
  }

  private becomeLeaderWhenPossible() {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) {
      void this.lead();
      return;
    }
    void locks.request(`eft-sync:${this.cacheKey}`, () => {
      if (this.closed) return undefined;
      void this.lead();
      return new Promise<void>((resolve) => {
        this.releaseLock = resolve;
      });
    });
  }

  private async lead() {
    this.leader = true;
    await this.catchUp();
    this.connectFeed();
    void this.drain();
    void this.syncPlans();
  }

  private onOnline = () => {
    this.setStatus({ online: true });
    this.backoff = 1_000;
    if (this.leader) {
      this.connectFeed();
      void this.drain();
      void this.syncPlans();
    }
  };

  private onOffline = () => this.setStatus({ online: false });

  private async onChannel(message: ChannelMessage) {
    if (message.type === "signed-out") {
      window.location.reload();
      return;
    }
    if (message.type === "queue") {
      if (this.leader) void this.drain();
      else await this.reload();
      return;
    }
    await this.reload();
  }

  private post(message: ChannelMessage) {
    try {
      this.channel?.postMessage(message);
    } catch {
      // the channel closed
    }
  }

  // Reading

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onNotice(listener: (notice: Notice) => void) {
    this.noticeListeners.add(listener);
    return () => {
      this.noticeListeners.delete(listener);
    };
  }

  private notify() {
    this.version += 1;
    const conflicts = [...this.records.values()].filter((record) => record.conflict).length;
    const problems = [...this.records.values()].filter((record) => record.problem).length;
    this.status = { ...this.status, conflicts, problems, queued: this.queueCount };
    for (const listener of this.listeners) listener();
  }

  private setStatus(changes: Partial<SyncStatus>) {
    this.status = { ...this.status, ...changes };
    this.notify();
  }

  /** A stable snapshot for useSyncExternalStore: the same object until something changes. */
  view(): LibraryView {
    if (this.snapshotCache?.version === this.version) return this.snapshotCache.value;
    const live = [...this.records.values()];
    const value: LibraryView = {
      ready: this.ready,
      builds: live.flatMap((record) => (record.local?.kind === "build" ? [record.local] : [])),
      itemGroups: live.flatMap((record) => (record.local?.kind === "item_group" ? [record.local] : [])),
      settings: new Map(live.flatMap((record) => (record.local?.kind === "setting" ? [[record.id, record.local] as const] : []))),
      plans: [...this.planIndex.values()],
      cachedPlans: this.cachedPlans,
      issues: live.filter((record) => record.conflict || record.problem),
      status: this.status,
      usage: this.usage,
      limits: this.limits,
      displayName: this.displayName,
      notices: this.notices,
    };
    this.snapshotCache = { version: this.version, value };
    return value;
  }

  get(kind: RecordKind, id: string) {
    return this.records.get(recordKey(kind, id))?.local ?? null;
  }

  private async reload() {
    if (!this.db) return;
    const [records, queue, plans] = await Promise.all([
      readAll<CachedRecord>(this.db, "records"),
      readAll<StoredQueueEntry>(this.db, "queue"),
      readAll<{ planId: string; index?: PlanIndexRecord }>(this.db, "plans"),
    ]);
    this.records = new Map(records.map((record) => [record.key, record]));
    this.queueCount = queue.length;
    const meta = await readMeta<{ usage: Usage; limits: Usage; displayName: string; notices: Notice[] }>(this.db, "account");
    if (meta) {
      this.usage = meta.usage;
      this.limits = meta.limits;
      this.displayName = meta.displayName;
      this.notices = meta.notices;
    }
    this.planIndex = new Map(plans.flatMap((plan) => (plan.index ? [[plan.planId, plan.index] as const] : [])));
    this.cachedPlans = summarizePlans(plans);
    this.notify();
  }

  /** Re-reads the cached plans (after a plan session wrote one). */
  async reloadPlans() {
    if (!this.db) return;
    this.cachedPlans = summarizePlans(await readAllPlans(this.db));
    this.notify();
    this.post({ type: "plans", planIds: [] });
  }

  private openSessions = new Set<string>();

  /** Plan pages register their plan, so background sync leaves it to them. */
  planOpened(planId: string) {
    this.openSessions.add(planId);
    return () => {
      this.openSessions.delete(planId);
    };
  }

  /**
   * Keeps every plan in the index cached and replays queued edits (§12.8): plans not cached yet, or
   * behind the index's rev, are fetched; plans with queued batches or a pending create replay.
   * Two at a time, in the background; plans open in this tab are left to their page.
   */
  async syncPlans(only?: string[]) {
    if (!this.db || !this.leader || this.planSyncing) return;
    this.planSyncing = true;
    try {
      const cached = new Map((await readAllPlans(this.db)).map((plan) => [plan.planId, plan]));
      const due = new Set<string>();
      for (const [planId, entry] of this.planIndex) {
        if (only && !only.includes(planId)) continue;
        const plan = cached.get(planId);
        if (entry.status !== "active") continue;
        if (!plan?.state || (entry.rev ?? 0) > plan.state.rev) due.add(planId);
      }
      for (const plan of cached.values()) if ((plan.queued ?? 0) > 0 || plan.pendingCreate) due.add(plan.planId);
      const { PlanSession } = await import("./plan-session");
      const work = [...due].filter((planId) => !this.openSessions.has(planId));
      const run = async () => {
        for (let planId = work.shift(); planId; planId = work.shift()) {
          const session = new PlanSession(this, planId);
          try {
            await session.open({ poll: false });
            await session.flush();
          } catch {
            // Offline or refused: tried again on the next sync.
          } finally {
            session.close();
          }
        }
      };
      await Promise.all([run(), run()]);
      await this.reloadPlans();
    } finally {
      this.planSyncing = false;
    }
  }

  // Writing

  createBuild(value: BuildValue) {
    const id = newRecordId();
    void this.enqueue({ mutationId: newOperationId(), kind: "build", op: "create", id, value });
    return id;
  }

  createGroup(value: GroupValue) {
    const id = newRecordId();
    void this.enqueue({ mutationId: newOperationId(), kind: "item_group", op: "create", id, value });
    return id;
  }

  /** Records the change between the current local value and `next` as a patch. */
  update(kind: "build" | "item_group", id: string, next: LibraryRecord) {
    const cached = this.records.get(recordKey(kind, id));
    if (!cached?.local) throw new Error("This no longer exists in your library.");
    const patch = diffRecords(cached.local, next);
    if (!patch) return;
    void this.enqueue({ mutationId: newOperationId(), kind, op: "patch", id, baseVersion: cached.server?.version ?? 0, patch } as Mutation);
  }

  setSetting(key: string, value: unknown) {
    const cached = this.records.get(recordKey("setting", key));
    void this.enqueue({ mutationId: newOperationId(), kind: "setting", op: "patch", id: key, baseVersion: cached?.server?.version ?? 0, patch: { value, changedAt: Date.now() } });
  }

  remove(kind: RecordKind, id: string) {
    const cached = this.records.get(recordKey(kind, id));
    if (!cached) return;
    void this.enqueue({ mutationId: newOperationId(), kind, op: "delete", id, baseVersion: cached.server?.version ?? 0 });
  }

  /**
   * Applies the mutation to the local value and queues it, in one IndexedDB transaction; the UI
   * updates at once, before the server answers.
   */
  private async enqueue(mutation: Mutation) {
    const key = recordKey(mutation.kind, mutation.id);
    const cached = this.records.get(key) ?? { key, kind: mutation.kind, id: mutation.id, server: null, local: null };
    const next: CachedRecord = { ...cached, local: applyMutationLocally(cached.local, mutation, Date.now()), problem: undefined };
    this.records.set(key, next);
    this.queueCount += 1;
    this.notify();
    if (!this.db) return;
    await transact(this.db, ["records", "queue"], "readwrite", (tx) => {
      tx.objectStore("records").put(next);
      tx.objectStore("queue").add({ key, mutation } satisfies QueueEntry);
    });
    this.post({ type: "records", keys: [key] });
    if (this.leader) void this.drain();
    else this.post({ type: "queue" });
  }

  // Replay

  /** Sends queued mutations in order, in batches of up to 50, until the queue is empty or a retry waits. */
  async drain() {
    if (!this.db || !this.leader || this.draining || this.closed) return;
    this.draining = true;
    this.setStatus({ syncing: true });
    try {
      for (;;) {
        const queue = (await readAll<StoredQueueEntry>(this.db, "queue")).sort((a, b) => a.seq - b.seq);
        this.queueCount = queue.length;
        if (queue.length === 0) break;
        const batch = await this.prepareBatch(queue);
        if (batch.length === 0) continue;
        const response = await this.request("/api/library/mutations", { method: "POST", body: JSON.stringify({ mutations: batch.map((entry) => entry.mutation) }) });
        if (response.status === 401) {
          this.setStatus({ online: true });
          break;
        }
        if (response.status === 429) {
          this.scheduleRetry(Number(response.headers.get("Retry-After") ?? "5") * 1000);
          break;
        }
        if (!response.ok) throw new Error(`Sync failed with ${response.status}.`);
        const { results } = (await response.json()) as { results: MutationResult[] };
        const retryAfter = await this.applyResults(batch, results);
        if (retryAfter !== null) {
          this.scheduleRetry(retryAfter * 1000);
          break;
        }
      }
      this.backoff = 1_000;
      this.setStatus({ online: true, lastSyncedAt: Date.now() });
    } catch {
      this.setStatus({ online: false });
      this.scheduleRetry(this.backoff);
      this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    } finally {
      this.draining = false;
      this.setStatus({ syncing: false });
    }
  }

  private scheduleRetry(delay: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.drain();
    }, delay);
  }

  /**
   * One mutation per record per batch. An entry already sent goes again unchanged (same mutation id,
   * so a lost answer can't apply it twice); otherwise the record's queued entries are folded into one,
   * which is stored as sent before the request.
   */
  private async prepareBatch(queue: StoredQueueEntry[]): Promise<StoredQueueEntry[]> {
    const byKey = new Map<string, StoredQueueEntry[]>();
    for (const entry of queue) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
    const batch: StoredQueueEntry[] = [];
    const rewrites: { remove: number[]; put: StoredQueueEntry | null }[] = [];
    for (const entries of byKey.values()) {
      if (batch.length >= BATCH_SIZE) break;
      if (entries[0].sent) {
        batch.push(entries[0]);
        continue;
      }
      const [folded] = foldQueue(entries, Date.now());
      const first = entries[0].seq;
      if (!folded.mutation) {
        rewrites.push({ remove: entries.map((entry) => entry.seq), put: null });
        continue;
      }
      const entry: StoredQueueEntry = { seq: first, key: entries[0].key, mutation: folded.mutation, sent: true };
      rewrites.push({ remove: entries.map((item) => item.seq), put: entry });
      batch.push(entry);
    }
    if (rewrites.length > 0 && this.db) {
      await transact(this.db, ["queue"], "readwrite", (tx) => {
        const store = tx.objectStore("queue");
        for (const rewrite of rewrites) {
          for (const seq of rewrite.remove) store.delete(seq);
          if (rewrite.put) store.put(rewrite.put);
        }
      });
    }
    return batch;
  }

  /** Stores each result; returns seconds to wait when the server asked to slow down. */
  private async applyResults(batch: StoredQueueEntry[], results: MutationResult[]): Promise<number | null> {
    if (!this.db) return null;
    const queue = (await readAll<StoredQueueEntry>(this.db, "queue")).sort((a, b) => a.seq - b.seq);
    const changed = new Map<string, CachedRecord>();
    const removeSeqs: number[] = [];
    const putEntries: StoredQueueEntry[] = [];
    let retryAfter: number | null = null;
    const now = Date.now();
    for (const [index, entry] of batch.entries()) {
      const result = results[index];
      if (!result || retryAfter !== null) break;
      const key = entry.key;
      const cached = changed.get(key) ?? this.records.get(key) ?? { key, kind: entry.mutation.kind, id: entry.mutation.id, server: null, local: null };
      const remaining = queue.filter((item) => item.key === key && item.seq !== entry.seq);
      const action = actionFor(result, entry.mutation, cached.local);
      if (action.type === "retry") {
        retryAfter = action.afterSeconds;
        break;
      }
      removeSeqs.push(entry.seq);
      let server = cached.server;
      let conflict = cached.conflict;
      let problem = cached.problem;
      if (action.type === "confirm") {
        const expected = applyMutationLocally(cached.server, entry.mutation, now);
        server = action.record;
        // Later edits were made on top of this one: they now start from the confirmed version, unless
        // another device's change (seen because this write merged) touched the same fields.
        const remote = result.status === "applied" && result.merged ? remoteChangedFields(expected, action.record) : [];
        for (const later of remaining) {
          if (later.mutation.op === "create") continue;
          const clashes = later.mutation.op === "patch" ? clashesWith(later.mutation.kind, later.mutation.patch, remote) : remote;
          if (clashes.length === 0 && later.mutation.baseVersion < action.record.version) {
            const updated = { ...later, mutation: { ...later.mutation, baseVersion: action.record.version } as Mutation };
            putEntries.push(updated);
            remaining.splice(remaining.indexOf(later), 1, updated);
          }
        }
        if (action.restored) this.emitNotice({ id: -now, kind: "restored", body: "Restored because it was edited on another device.", createdAt: now });
      } else if (action.type === "conflict") {
        server = action.conflict.theirs.record;
        conflict = action.conflict;
        if (action.rest) {
          const rest: StoredQueueEntry = {
            seq: entry.seq,
            key,
            mutation: { ...(entry.mutation as Mutation & { op: "patch" }), mutationId: newOperationId(), baseVersion: action.conflict.theirs.version, patch: action.rest } as Mutation,
          };
          removeSeqs.pop();
          putEntries.push(rest);
          remaining.unshift(rest);
        }
        this.post({ type: "conflict", key });
      } else if (action.type === "recreate") {
        const value = stripRecord(cached.local);
        if (value && entry.mutation.kind !== "setting") {
          const create: StoredQueueEntry = { seq: entry.seq, key, mutation: { mutationId: newOperationId(), kind: entry.mutation.kind, op: "create", id: entry.mutation.id, value } as Mutation };
          removeSeqs.pop();
          putEntries.push(create);
          remaining.unshift(create);
          server = null;
        }
      } else if (action.type === "problem") {
        problem = action.problem;
      } else if (action.type === "drop") {
        server = null;
      }
      const local = rebase(server, remaining.map((item) => item.mutation), now);
      changed.set(key, { ...cached, server, local, conflict, problem });
    }
    await transact(this.db, ["records", "queue"], "readwrite", (tx) => {
      const queueStore = tx.objectStore("queue");
      for (const seq of removeSeqs) queueStore.delete(seq);
      for (const entry of putEntries) queueStore.put(entry);
      const recordStore = tx.objectStore("records");
      for (const record of changed.values()) {
        if (!record.server && !record.local && !record.problem && !record.conflict) recordStore.delete(record.key);
        else recordStore.put(record);
      }
    });
    for (const record of changed.values()) {
      if (!record.server && !record.local && !record.problem && !record.conflict) this.records.delete(record.key);
      else this.records.set(record.key, record);
    }
    this.queueCount = Math.max(0, this.queueCount - removeSeqs.length + putEntries.filter((entry) => removeSeqs.includes(entry.seq)).length);
    this.notify();
    this.post({ type: "records", keys: [...changed.keys()] });
    return retryAfter;
  }

  // Server changes

  /** On sign-in and reconnect: changes since the cursor, or the full snapshot when there is none or it is too old. */
  async catchUp() {
    try {
      if (this.seq < 0) {
        await this.resync();
        return;
      }
      const response = await this.request(`/api/library/changes?since=${this.seq}`);
      if (!response.ok) throw new Error(String(response.status));
      const changes = (await response.json()) as ChangesResult;
      if (changes.resync) await this.resync();
      else await this.applyServerChanges(changes.seq, changes.records, changes.tombstones, []);
      this.setStatus({ online: true });
    } catch {
      this.setStatus({ online: false });
    }
  }

  /**
   * The full snapshot (§12.3): replaces every cached record that has no queued change; queued
   * changes stay and replay as usual, so compare-and-set decides them.
   */
  async resync() {
    const response = await this.request("/api/library");
    if (!response.ok) throw new Error(String(response.status));
    const snapshot = (await response.json()) as LibrarySnapshot;
    const present = new Set(snapshot.records.map((record) => (record.kind === "plan" ? `plan:${record.id}` : recordKey(record.kind, record.id))));
    const tombstones = [...this.records.values()]
      .filter((record) => record.server && !present.has(record.key))
      .map((record) => ({ kind: record.kind, id: record.id, version: record.server!.version + 1 }));
    const staleIndex = [...this.planIndex.keys()].filter((planId) => !present.has(`plan:${planId}`)).map((planId) => ({ kind: "plan" as const, id: planId, version: 0 }));
    this.usage = snapshot.usage;
    this.limits = snapshot.limits;
    this.displayName = snapshot.displayName;
    this.notices = snapshot.notices;
    await this.applyServerChanges(snapshot.seq, snapshot.records, [...tombstones, ...staleIndex], []);
    await transact(this.db!, ["meta"], "readwrite", (tx) =>
      tx.objectStore("meta").put({ usage: snapshot.usage, limits: snapshot.limits, displayName: snapshot.displayName, notices: snapshot.notices }, "account")
    );
  }

  private async applyServerChanges(seq: number, records: LibraryRecord[], tombstones: { kind: string; id: string; version: number }[], ownMutationIds: string[]) {
    if (!this.db) return;
    void ownMutationIds;
    const queue = await readAll<StoredQueueEntry>(this.db, "queue");
    const changed: CachedRecord[] = [];
    const removed: string[] = [];
    const planChanges: PlanIndexRecord[] = [];
    const planRemovals: string[] = [];
    const now = Date.now();
    for (const record of records) {
      if (record.kind === "plan") {
        planChanges.push(record);
        continue;
      }
      const key = recordKey(record.kind, record.id);
      const cached = this.records.get(key) ?? { key, kind: record.kind, id: record.id, server: null, local: null };
      if (cached.server && cached.server.version > record.version) continue;
      const queued = queue.filter((entry) => entry.key === key).sort((a, b) => a.seq - b.seq);
      changed.push({ ...cached, server: record, local: rebase(record, queued.map((entry) => entry.mutation), now) });
    }
    for (const tombstone of tombstones) {
      if (tombstone.kind === "plan") {
        planRemovals.push(tombstone.id);
        continue;
      }
      const key = `${tombstone.kind}:${tombstone.id}`;
      const cached = this.records.get(key);
      if (!cached) continue;
      const queued = queue.filter((entry) => entry.key === key);
      if (queued.length > 0) {
        // An edit queued here wins over the delete: it restores the record when it replays.
        changed.push({ ...cached, server: cached.server ? { ...cached.server, deleted: true, version: tombstone.version } : null });
      } else if (cached.problem || cached.conflict) {
        changed.push({ ...cached, server: null, local: null });
      } else {
        removed.push(key);
      }
    }
    this.seq = seq;
    await transact(this.db, ["records", "meta", "plans"], "readwrite", (tx) => {
      const store = tx.objectStore("records");
      for (const record of changed) store.put(record);
      for (const key of removed) store.delete(key);
      tx.objectStore("meta").put(seq, "seq");
      const plans = tx.objectStore("plans");
      for (const plan of planChanges) {
        const request = plans.get(plan.id);
        request.onsuccess = () => plans.put({ ...(request.result ?? { planId: plan.id }), index: plan });
      }
      for (const planId of planRemovals) {
        const request = plans.get(planId);
        request.onsuccess = () => {
          if (!request.result) return;
          // A cached plan with queued edits stays until its replay settles (§12.8); otherwise it goes now.
          if (request.result.queued) plans.put({ ...request.result, index: undefined, lostAccess: true });
          else plans.delete(planId);
        };
      }
    });
    for (const record of changed) this.records.set(record.key, record);
    for (const key of removed) this.records.delete(key);
    for (const plan of planChanges) this.planIndex.set(plan.id, plan);
    for (const planId of planRemovals) this.planIndex.delete(planId);
    if (planChanges.length || planRemovals.length) {
      this.post({ type: "plans", planIds: [...planChanges.map((plan) => plan.id), ...planRemovals] });
      for (const listener of this.planListeners) listener([...planChanges.map((plan) => plan.id), ...planRemovals]);
      await this.reloadPlans();
      if (this.leader) void this.syncPlans(planChanges.map((plan) => plan.id));
    }
    this.notify();
    this.post({ type: "records", keys: [...changed.map((record) => record.key), ...removed] });
  }

  private planListeners = new Set<(planIds: string[]) => void>();

  /** Plan index changes from the feed (joined, removed, renamed, a newer rev). */
  onPlans(listener: (planIds: string[]) => void) {
    this.planListeners.add(listener);
    return () => {
      this.planListeners.delete(listener);
    };
  }

  private connectFeed() {
    if (!this.leader || this.closed || this.socket || typeof WebSocket === "undefined") return;
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/api/library/live?since=${Math.max(0, this.seq)}&device=${encodeURIComponent(this.deviceId)}`);
    this.socket = socket;
    socket.onmessage = (event) => {
      if (event.data === "pong") return;
      let message: FeedMessage;
      try {
        message = JSON.parse(String(event.data)) as FeedMessage;
      } catch {
        return;
      }
      if (message.type === "resync") void this.resync().catch(() => undefined);
      else if (message.type === "notice") this.emitNotice(message.notice);
      else void this.applyServerChanges(message.seq, message.records, message.tombstones, message.originMutationIds);
    };
    socket.onopen = () => {
      this.backoff = 1_000;
      this.setStatus({ online: true });
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, PING_INTERVAL_MS);
      void this.drain();
    };
    socket.onclose = (event) => {
      this.dropSocket();
      if (this.closed || event.code === 4001) return;
      const delay = this.backoff;
      this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
      setTimeout(() => this.connectFeed(), delay);
    };
  }

  private dropSocket() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  }

  private emitNotice(notice: Notice) {
    this.notices = [notice, ...this.notices.filter((item) => item.id !== notice.id)].slice(0, 50);
    this.notify();
    for (const listener of this.noticeListeners) listener(notice);
  }

  async dismissNotices(ids: number[]) {
    this.notices = this.notices.filter((notice) => !ids.includes(notice.id));
    this.notify();
    const serverIds = ids.filter((id) => id > 0);
    if (serverIds.length) await this.request("/api/notices/read", { method: "POST", body: JSON.stringify({ ids: serverIds }) }).catch(() => undefined);
  }

  // Conflicts and problems (§12.4)

  /** Keep mine: re-sends this device's change on top of the other device's version. */
  keepMine(key: string) {
    const cached = this.records.get(key);
    const conflict = cached?.conflict;
    if (!cached || !conflict) return;
    this.records.set(key, { ...cached, conflict: undefined });
    if (conflict.type === "delete") {
      void this.enqueue({ mutationId: newOperationId(), kind: cached.kind, op: "delete", id: cached.id, baseVersion: conflict.theirs.version });
      return;
    }
    void this.enqueue({ mutationId: newOperationId(), kind: cached.kind, op: "patch", id: cached.id, baseVersion: conflict.theirs.version, patch: conflict.mine } as Mutation);
  }

  /** Keep theirs: drops this device's change to the clashing fields (or cancels the delete). */
  async keepTheirs(key: string) {
    const cached = this.records.get(key);
    if (!cached?.conflict || !this.db) return;
    const next = { ...cached, conflict: undefined };
    this.records.set(key, next);
    await transact(this.db, ["records"], "readwrite", (tx) => tx.objectStore("records").put(next));
    this.notify();
    this.post({ type: "records", keys: [key] });
  }

  /**
   * Keep both: the other device's version stays, and this device's version becomes a copy named
   * "<name> (this device)", which counts toward the limits.
   */
  async keepBoth(key: string) {
    const cached = this.records.get(key);
    const conflict = cached?.conflict;
    if (!cached || conflict?.type !== "fields" || !conflict.mineValue) return;
    const value = stripRecord(conflict.mineValue);
    if (!value) return;
    await this.keepTheirs(key);
    const named = { ...value, name: `${value.name.slice(0, 106)} (this device)` };
    if (cached.kind === "build") this.createBuild(named as BuildValue);
    else if (cached.kind === "item_group") this.createGroup(named as GroupValue);
  }

  /** Couldn't sync → Discard: forgets this device's version. */
  async discardProblem(key: string) {
    const cached = this.records.get(key);
    if (!cached || !this.db) return;
    const next: CachedRecord = { ...cached, problem: undefined, local: cached.server && !cached.server.deleted ? cached.server : null };
    if (!next.server && !next.local) this.records.delete(key);
    else this.records.set(key, next);
    await transact(this.db, ["records"], "readwrite", (tx) => (!next.server && !next.local ? tx.objectStore("records").delete(key) : tx.objectStore("records").put(next)));
    this.notify();
  }

  /** Couldn't sync → Try again (once there is room). */
  retryProblem(key: string) {
    const cached = this.records.get(key);
    const value = cached?.problem?.value;
    if (!cached || !value) return;
    this.records.set(key, { ...cached, problem: undefined });
    if (cached.server && !cached.server.deleted) {
      const patch = diffRecords(cached.server, value);
      if (patch) void this.enqueue({ mutationId: newOperationId(), kind: cached.kind, op: "patch", id: cached.id, baseVersion: cached.server.version, patch } as Mutation);
      return;
    }
    const content = stripRecord(value);
    if (content) void this.enqueue({ mutationId: newOperationId(), kind: cached.kind, op: "create", id: cached.server ? newRecordId() : cached.id, value: content } as Mutation);
  }

  // Requests

  async request(path: string, init: RequestInit = {}) {
    return fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  }

  /** Signing out: whether anything would be lost (§12.7). */
  async unsyncedCount() {
    if (!this.db) return 0;
    const [queue, planQueue, issues] = await Promise.all([readAll(this.db, "queue"), readAll(this.db, "plan_queue"), readAll(this.db, "plan_issues")]);
    return queue.length + planQueue.length + issues.length + [...this.records.values()].filter((record) => record.conflict || record.problem).length;
  }

  signedOut() {
    this.post({ type: "signed-out" });
  }

  patchFor(kind: RecordKind, id: string): Patch | null {
    const cached = this.records.get(recordKey(kind, id));
    if (!cached?.server || !cached.local) return null;
    return diffRecords(cached.server, cached.local);
  }
}

/** A plan as the plans list shows it: from the index, a pending create, or an offline copy. */
export interface CachedPlanSummary {
  planId: string;
  name: string;
  mapKey: string;
  role: "owner" | "editor" | "viewer";
  relation: "owned" | "shared";
  kind: "synced" | "pending-create" | "offline-copy";
  queued: number;
  updatedAt: number;
  counts: { route: number; drawings: number; notes: number } | null;
}

function summarizePlans(plans: CachedPlan[]): CachedPlanSummary[] {
  return plans.flatMap((plan): CachedPlanSummary[] => {
    if (plan.offlineCopy) {
      const doc = plan.offlineCopy.doc;
      return [
        {
          planId: plan.planId,
          name: plan.offlineCopy.name,
          mapKey: doc.mapKey,
          role: "owner",
          relation: "owned",
          kind: "offline-copy",
          queued: 0,
          updatedAt: plan.offlineCopy.createdAt,
          counts: { route: Object.keys(doc.waypoints).length, drawings: Object.keys(doc.drawings).length, notes: Object.keys(doc.notes).length },
        },
      ];
    }
    const doc = plan.state?.doc;
    if (!plan.index && !plan.pendingCreate && !plan.state) return [];
    return [
      {
        planId: plan.planId,
        name: doc?.name ?? plan.index?.name ?? "Untitled raid",
        mapKey: doc?.mapKey ?? plan.index?.mapKey ?? "",
        role: plan.index?.role ?? plan.state?.role ?? "owner",
        relation: plan.index?.relation ?? "owned",
        kind: plan.pendingCreate ? "pending-create" : "synced",
        queued: plan.queued ?? 0,
        updatedAt: Math.max(plan.index?.updatedAt ?? 0, plan.state?.updatedAt ?? 0),
        counts: doc ? { route: Object.keys(doc.waypoints).length, drawings: Object.keys(doc.drawings).length, notes: Object.keys(doc.notes).length } : null,
      },
    ];
  });
}

export interface LibraryView {
  ready: boolean;
  builds: Extract<LibraryRecord, { kind: "build" }>[];
  itemGroups: Extract<LibraryRecord, { kind: "item_group" }>[];
  settings: Map<string, Extract<LibraryRecord, { kind: "setting" }>>;
  plans: PlanIndexRecord[];
  cachedPlans: CachedPlanSummary[];
  issues: CachedRecord[];
  status: SyncStatus;
  usage: Usage | null;
  limits: Usage | null;
  displayName: string;
  notices: Notice[];
}
