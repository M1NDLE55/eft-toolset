import type { RaidPlan } from "@/app/lib/raid-planner/types";
import { unwrap } from "./outcome";
import { checkPlanContent, type StoredPlan } from "./plan-store";
import type { PlanDO } from "./plan-do";
import type { UserDO } from "./user-do";
import type { PlanRole } from "./user-store";

/**
 * How the rest of the Worker reaches per-user and per-plan state. Users are named by their WorkOS
 * user id (the MCP token's `sub`, the website session's user), so the same object serves the
 * website, every MCP client and every reconnect. Operations that touch a plan and its members'
 * indexes keep them in step here, checking limits before anything is written.
 */
export interface DurableBindings {
  USER: DurableObjectNamespace<UserDO>;
  PLAN: DurableObjectNamespace<PlanDO>;
}

export function userObject(env: DurableBindings, userId: string) {
  return env.USER.get(env.USER.idFromName(userId));
}

export function planObject(env: DurableBindings, planId: string) {
  return env.PLAN.get(env.PLAN.idFromName(planId));
}

function indexEntry(stored: StoredPlan, role: PlanRole) {
  return { planId: stored.planId, role, title: stored.plan.name, map: stored.plan.mapKey, updatedAt: stored.updatedAt };
}

/** Creates a plan the user owns: content checked, owned-plan and hourly limits checked, then stored. */
export async function createPlan(env: DurableBindings, userId: string, content: RaidPlan): Promise<StoredPlan> {
  checkPlanContent(content);
  const user = userObject(env, userId);
  unwrap(await user.reservePlanCreation());
  const planId = crypto.randomUUID();
  const stored = unwrap(await planObject(env, planId).create(planId, userId, content));
  unwrap(await user.recordPlan(indexEntry(stored, "owner"), "created"));
  return stored;
}

/** Saves new content; every member's index shows the new title and edit time. */
export async function updatePlan(env: DurableBindings, userId: string, planId: string, content: RaidPlan, expectedVersion?: number) {
  const plan = planObject(env, planId);
  const stored = unwrap(await plan.update(userId, content, expectedVersion));
  const members = unwrap(await plan.members(userId));
  const details = { title: stored.plan.name, map: stored.plan.mapKey, updatedAt: stored.updatedAt };
  await Promise.all(members.map((member) => userObject(env, member.userId).touchPlan(planId, details)));
  return stored;
}

/** Shares a plan: the other user's shared-plan limit is checked before the plan changes. */
export async function sharePlan(env: DurableBindings, ownerId: string, planId: string, userId: string, role: Exclude<PlanRole, "owner">) {
  const plan = planObject(env, planId);
  const stored = unwrap(await plan.read(ownerId));
  if (stored.role !== "owner") throw new Error("Only the plan's owner can share it.");
  const other = userObject(env, userId);
  unwrap(await other.recordPlan(indexEntry(stored, role), "shared"));
  const shared = await plan.share(ownerId, userId, role);
  if (!shared.ok) await other.forgetPlan(planId);
  unwrap(shared);
}

/** Removes someone from a plan, or lets a member leave it. */
export async function unsharePlan(env: DurableBindings, actorId: string, planId: string, userId: string) {
  unwrap(await planObject(env, planId).unshare(actorId, userId));
  await userObject(env, userId).forgetPlan(planId);
}

/**
 * Hands a plan to another member. Allowed even when it takes them past their owned-plan limit;
 * they can't create plans until they are back under it.
 */
export async function transferPlan(env: DurableBindings, ownerId: string, planId: string, toUserId: string) {
  const plan = planObject(env, planId);
  unwrap(await plan.transfer(ownerId, toUserId));
  const stored = unwrap(await plan.read(toUserId));
  unwrap(await userObject(env, toUserId).recordPlan(indexEntry(stored, "owner"), "transferred"));
  unwrap(await userObject(env, ownerId).recordPlan(indexEntry(stored, "editor"), "transferred"));
}

/** Deletes a plan and removes it from every member's index. */
export async function deletePlan(env: DurableBindings, ownerId: string, planId: string) {
  const members = unwrap(await planObject(env, planId).delete(ownerId));
  await Promise.all(members.map((member) => userObject(env, member).forgetPlan(planId)));
}
