import type { PlanDoc, PlanOp } from "@/app/lib/sharing/plan-doc";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import type { PlanIndexRecord, Role } from "@/app/lib/sharing/types";
import type { PublicMember } from "@/app/lib/durable/plan-store";
import { transact } from "./idb";

/**
 * Cached raid plans in the account cache (§12.5, §12.8): every plan in the user's index, as last
 * confirmed by PlanDO, with the user's queued op batches and the "Couldn't apply" list. A plan made
 * offline waits as a pending create; a plan whose access was lost while offline becomes an offline
 * copy that never syncs.
 */
export interface ConfirmedPlan {
  rev: number;
  doc: PlanDoc;
  role: Role;
  allowCopy: boolean;
  createdAt: number;
  updatedAt: number;
  members?: PublicMember[];
  syncedAt: number;
}

export interface CachedPlan {
  planId: string;
  index?: PlanIndexRecord;
  state?: ConfirmedPlan;
  /** Created offline: replays as POST /api/plans with this id, then its ops. */
  pendingCreate?: { content: PlanContent };
  /** Access was lost with edits queued: what the user last saw (or only their own additions). */
  offlineCopy?: { doc: PlanDoc; name: string; reason: string; createdAt: number };
  queued?: number;
  openedAt?: number;
  lostAccess?: boolean;
}

export interface QueuedBatch {
  planId: string;
  seq: number;
  opId: string;
  ops: PlanOp[];
  /** Each touched entity's rev when the batch was made, to tell the user what a replay overwrote. */
  base: Record<string, number | null>;
  /** The confirmed rev when it was made: a batch made at an older rev was made offline. */
  madeAtRev: number;
  /** The items it touched as they were after it, for "Add it back" if someone deletes them meanwhile. */
  after?: Record<string, unknown>;
  createdAt: number;
}

export type PlanIssueKind = "gone" | "limit" | "invalid" | "create";

/** A change that couldn't be applied, listed until the user chooses (§12.8). */
export interface PlanIssue {
  planId: string;
  opId: string;
  kind: PlanIssueKind;
  message: string;
  ops: PlanOp[];
  /** The items as the user last had them, for "Add it back". */
  restore: PlanOp[];
  createdAt: number;
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readPlan(db: IDBDatabase, planId: string): Promise<CachedPlan | undefined> {
  return promised(db.transaction("plans", "readonly").objectStore("plans").get(planId) as IDBRequest<CachedPlan | undefined>);
}

export async function readAllPlans(db: IDBDatabase): Promise<CachedPlan[]> {
  return promised(db.transaction("plans", "readonly").objectStore("plans").getAll() as IDBRequest<CachedPlan[]>);
}

export async function writePlan(db: IDBDatabase, plan: CachedPlan) {
  await transact(db, ["plans"], "readwrite", (tx) => tx.objectStore("plans").put(plan));
}

export async function deletePlanCache(db: IDBDatabase, planId: string) {
  await transact(db, ["plans", "plan_queue", "plan_issues"], "readwrite", (tx) => {
    tx.objectStore("plans").delete(planId);
    tx.objectStore("plan_queue").delete(IDBKeyRange.bound([planId, 0], [planId, Number.MAX_SAFE_INTEGER]));
    tx.objectStore("plan_issues").delete(IDBKeyRange.bound([planId, ""], [planId, "￿"]));
  });
}

export async function readQueue(db: IDBDatabase, planId: string): Promise<QueuedBatch[]> {
  const rows = await promised(
    db.transaction("plan_queue", "readonly").objectStore("plan_queue").getAll(IDBKeyRange.bound([planId, 0], [planId, Number.MAX_SAFE_INTEGER])) as IDBRequest<QueuedBatch[]>
  );
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function readIssues(db: IDBDatabase, planId: string): Promise<PlanIssue[]> {
  const rows = await promised(db.transaction("plan_issues", "readonly").objectStore("plan_issues").getAll(IDBKeyRange.bound([planId, ""], [planId, "￿"])) as IDBRequest<PlanIssue[]>);
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

/** Queues a batch and updates the cached plan's queued count in one transaction. */
export async function queueBatch(db: IDBDatabase, batch: QueuedBatch) {
  await transact(db, ["plan_queue", "plans"], "readwrite", (tx) => {
    tx.objectStore("plan_queue").put(batch);
    const plans = tx.objectStore("plans");
    const request = plans.get(batch.planId);
    request.onsuccess = () => {
      const plan = (request.result as CachedPlan | undefined) ?? { planId: batch.planId };
      plans.put({ ...plan, queued: (plan.queued ?? 0) + 1 });
    };
  });
}

export async function unqueueBatch(db: IDBDatabase, planId: string, seq: number, issue?: PlanIssue) {
  await transact(db, ["plan_queue", "plans", "plan_issues"], "readwrite", (tx) => {
    tx.objectStore("plan_queue").delete([planId, seq]);
    if (issue) tx.objectStore("plan_issues").put(issue);
    const plans = tx.objectStore("plans");
    const request = plans.get(planId);
    request.onsuccess = () => {
      const plan = request.result as CachedPlan | undefined;
      if (plan) plans.put({ ...plan, queued: Math.max(0, (plan.queued ?? 1) - 1) });
    };
  });
}

export async function replaceQueued(db: IDBDatabase, batch: QueuedBatch) {
  await transact(db, ["plan_queue"], "readwrite", (tx) => tx.objectStore("plan_queue").put(batch));
}

export async function deleteIssue(db: IDBDatabase, planId: string, opId: string) {
  await transact(db, ["plan_issues"], "readwrite", (tx) => tx.objectStore("plan_issues").delete([planId, opId]));
}

/** Plans with queued batches or a pending create: the sync leader replays them on reconnect. */
export async function plansToReplay(db: IDBDatabase): Promise<string[]> {
  return (await readAllPlans(db)).filter((plan) => (plan.queued ?? 0) > 0 || plan.pendingCreate).map((plan) => plan.planId);
}
