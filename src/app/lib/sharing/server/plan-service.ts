import { planObject, userObject, type DurableBindings } from "@/app/lib/durable/access";
import { unwrap, type Outcome } from "@/app/lib/durable/outcome";
import { DomainError } from "@/app/lib/durable/sql";
import type { Actor } from "@/app/lib/durable/plan-store";
import { planHash } from "@/app/lib/sharing/content-hash";
import { isRecordId, newRecordId } from "@/app/lib/sharing/ids";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import type { PlanOp } from "@/app/lib/sharing/plan-doc";
import type { Role } from "@/app/lib/sharing/types";
import { fail, unwrapOutcome } from "./http";
import type { ImportResult } from "./library-routes";
import { resolveCode } from "./link-routes";

/**
 * Account raid plans across Durable Objects (§5.1). There are no transactions across objects, so:
 * reserve a slot in the user's index, act on the plan, then confirm (or release); the plan is the
 * authority on membership; side effects on other objects go through outboxes. At a count limit the
 * index is reconciled with the plans first, so a stale entry never blocks anyone.
 */

type CreateKind = "create" | "copy" | "import" | "offline-copy";

/** Asks each listed plan whether the user still belongs to it, and drops entries that are gone. */
async function reconcile(env: DurableBindings, userId: string, relation: "owned" | "shared") {
  const user = userObject(env, userId);
  const ids = [...new Set([...(await user.planIds(relation)), ...(await user.pendingPlans())])];
  await Promise.all(
    ids.map(async (planId) => {
      const role = await planObject(env, planId).memberRole(userId);
      const entry = await user.planEntry(planId);
      if (!role && entry && entry.status === "active") await user.forgetPlan(planId);
      if (!role && entry && entry.status === "pending" && Date.now() - entry.since > 60_000) await user.releasePlan(planId);
    })
  );
}

async function reserveWithReconcile<T>(attempt: () => Promise<Outcome<T>>, reconcileFirst: () => Promise<void>): Promise<Outcome<T>> {
  const first = await attempt();
  if (first.ok || first.error.code !== "limit") return first;
  const kind = first.error.details?.kind;
  if (kind !== "ownedPlans" && kind !== "sharedPlans") return first;
  await reconcileFirst();
  return attempt();
}

/**
 * Creates an account plan owned by the user: reserve (owned limit, hourly rate or import bucket),
 * PlanDO.init (content caps; refuses an id already used), confirm. A client id is accepted for plans
 * made offline.
 */
export async function createAccountPlan(
  env: DurableBindings,
  userId: string,
  content: PlanContent,
  options: { kind: CreateKind; id?: string; copiedFrom?: string | null }
): Promise<{ planId: string; duplicate: boolean; summary: { name: string; mapKey: string; rev: number; updatedAt: number } }> {
  const planId = options.id ?? newRecordId();
  if (!isRecordId(planId)) fail("invalid", "That plan id isn't valid.");
  const user = userObject(env, userId);
  const contentHash = options.kind === "import" ? planHash(content) : undefined;
  const reserved = unwrapOutcome(
    await reserveWithReconcile(
      () => user.reservePlan(planId, { kind: options.kind === "offline-copy" ? "create" : options.kind, contentHash, name: content?.name, mapKey: content?.mapKey }),
      () => reconcile(env, userId, "owned")
    )
  );
  if (reserved.status === "duplicate") {
    const entry = await user.planEntry(reserved.planId);
    return { planId: reserved.planId, duplicate: true, summary: { name: entry?.name ?? "", mapKey: entry?.mapKey ?? "", rev: entry?.rev ?? 0, updatedAt: entry?.updatedAt ?? 0 } };
  }
  const displayName = await user.displayName();
  const plan = planObject(env, planId);
  let summary;
  try {
    summary = unwrap(await plan.init({ id: userId, name: displayName }, content, { allowCopy: false, copiedFrom: options.copiedFrom ?? null }));
  } catch (error) {
    await user.releasePlan(planId);
    throw error;
  }
  await user.confirmPlan(planId, summary);
  return { planId, duplicate: false, summary };
}

export async function importPlans(env: DurableBindings, userId: string, plans: { index: number; value: unknown }[]): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const { index, value } of plans) {
    try {
      const created = await createAccountPlan(env, userId, value as PlanContent, { kind: "import" });
      results.push(created.duplicate ? { index, status: "duplicate", id: created.planId } : { index, status: "created", id: created.planId });
    } catch (error) {
      const code = error instanceof DomainError ? error.code : null;
      const message = error instanceof Error ? error.message : "That plan couldn't be moved.";
      results.push({ index, status: code === "limit" ? (/KB/.test(message) ? "too_large" : "limit") : code === "rate_limited" ? "rate_limited" : "invalid", message });
    }
  }
  return results;
}

/** POST /api/plans/:id/copy: a member copies a plan (needs "Allow copies", or ownership). */
export async function copyPlanAsMember(env: DurableBindings, userId: string, planId: string, name?: string) {
  const exported = unwrapOutcome(await planObject(env, planId).exportFor(userId));
  const content = { ...exported.content, name: (name ?? `${exported.name.slice(0, 115)} copy`).slice(0, 120) };
  const created = await createAccountPlan(env, userId, content, { kind: "copy", copiedFrom: exported.name });
  return { type: "plan" as const, id: created.planId, name: content.name };
}

export async function copyPlanFromLink(env: DurableBindings, userId: string, planId: string, code: string, name?: string) {
  const user = userObject(env, userId);
  unwrapOutcome(await user.charge("acceptsAndCopies"));
  const exported = unwrapOutcome(await planObject(env, planId).exportForLink(code));
  const content = { ...exported.content, name: (name ?? exported.name).slice(0, 120) };
  const created = await createAccountPlan(env, userId, content, { kind: "copy", copiedFrom: exported.name });
  return { type: "plan" as const, id: created.planId, name: content.name };
}

// Links (called from link-routes)

export async function createPlanLink(env: DurableBindings, userId: string, planId: string, code: string, body: { access?: string; role?: string; expiresIn?: number | null; maxUses?: number }, request: Request) {
  const { linkObject } = await import("@/app/lib/durable/access");
  const { inviteUrl, shareUrl } = await import("./link-routes");
  // The creator's hourly link bucket, editors' invites included (§7.5).
  unwrapOutcome(await userObject(env, userId).charge("linkCreation"));
  const created = unwrapOutcome(
    await planObject(env, planId).createLink(userId, code, {
      access: body.access as "view" | "copy" | "invite",
      role: body.role === "editor" || body.role === "viewer" ? body.role : undefined,
      expiresIn: body.expiresIn,
      maxUses: body.maxUses,
    })
  );
  if (!(await linkObject(env, code).init({ targetKind: "plan", targetName: planId }))) {
    await planObject(env, planId).revokeLink(userId, code);
    fail("conflict", "That link couldn't be made. Try again.");
  }
  return { ...created, url: created.access === "invite" ? inviteUrl(request, code) : shareUrl(request, code) };
}

export async function listPlanLinks(env: DurableBindings, userId: string, planId: string, request: Request) {
  const { inviteUrl, shareUrl } = await import("./link-routes");
  const links = unwrapOutcome(await planObject(env, planId).listLinks(userId));
  return links.map((link) => ({ ...link, url: link.access === "invite" ? inviteUrl(request, link.code) : shareUrl(request, link.code) }));
}

export async function revokePlanLink(env: DurableBindings, userId: string, planId: string, code: string) {
  return unwrapOutcome(await planObject(env, planId).revokeLink(userId, code));
}

export async function openPlanLink(env: DurableBindings, planId: string, code: string, viewerId: string | null) {
  return unwrapOutcome(await planObject(env, planId).openLink(code, viewerId));
}

// Invites (§10.3, §14.2)

export async function previewInvite(env: DurableBindings, code: string) {
  const target = await resolveCode(env, code);
  if (!target || target.targetKind !== "plan") fail("not_found", "That invite doesn't exist.");
  return unwrapOutcome(await planObject(env, target.targetName).previewInvite(code));
}

/**
 * Joins a plan: reserve a shared slot (the 100-plan limit), accept in PlanDO (valid, uses left, under
 * 50 members; idempotent for members), confirm in the index. Draws on the accepts-and-copies bucket.
 */
export async function acceptInvite(env: DurableBindings, userId: string, code: string): Promise<{ planId: string; role: Role; joined: boolean }> {
  const target = await resolveCode(env, code);
  if (!target || target.targetKind !== "plan") fail("not_found", "That invite doesn't exist.");
  const planId = target.targetName;
  const user = userObject(env, userId);
  const plan = planObject(env, planId);
  const existing = await plan.memberRole(userId);
  if (existing === "owner") return { planId, role: "owner", joined: false };
  unwrapOutcome(await user.charge("acceptsAndCopies"));
  const reserved = existing ? null : unwrapOutcome(await reserveWithReconcile(() => user.reserveShared(planId), () => reconcile(env, userId, "shared")));
  let accepted;
  try {
    accepted = unwrapOutcome(await plan.acceptInvite(code, { id: userId, name: await user.displayName() }));
  } catch (error) {
    if (reserved?.status === "reserved") await user.releasePlan(planId);
    throw error;
  }
  await user.setPlanEntry(planId, { role: accepted.role, summary: accepted.summary });
  return { planId, role: accepted.role, joined: accepted.joined };
}

// Editing

export async function applyPlanOps(env: DurableBindings, actor: Actor & { id: string }, planId: string, opId: string, ops: PlanOp[], knownRev?: number) {
  return unwrapOutcome(await planObject(env, planId).apply(actor, opId, ops, knownRev));
}

// Members and ownership (§14.3)

/**
 * Hands a plan to a member: the recipient's index accepts it (always, even past 100 owned plans,
 * unless that account is being deleted), then the plan changes owner. Explicit transfers keep the
 * former owner as an editor; a departing owner is removed.
 */
export async function transferPlan(env: DurableBindings, fromId: string, planId: string, toUserId: string, mode: "explicit" | "departing" = "explicit") {
  const plan = planObject(env, planId);
  const summary = mode === "explicit" ? unwrapOutcome(await plan.checkTransfer(fromId, toUserId)) : unwrapOutcome(await plan.summary());
  const fromName = await userObject(env, fromId).displayName();
  const notice = mode === "explicit" ? `You now own ${summary.name}: ${fromName} handed it to you.` : `You now own ${summary.name} because ${fromName} left.`;
  unwrapOutcome(await userObject(env, toUserId).receiveOwnership(planId, summary, notice));
  unwrapOutcome(await plan.completeTransfer(fromId, toUserId, mode));
  if (mode === "explicit") await userObject(env, fromId).setPlanEntry(planId, { role: "editor", summary });
  else await userObject(env, fromId).forgetPlan(planId);
}

/**
 * The owner leaves, or their account is deleted: the plan passes to the next member (editors first,
 * then who joined first), skipping anyone whose account is being deleted. With no one left, it is deleted.
 */
export async function ownerDeparting(env: DurableBindings, ownerId: string, planId: string): Promise<"transferred" | "deleted"> {
  const plan = planObject(env, planId);
  for (const candidate of await plan.successors(ownerId)) {
    try {
      await transferPlan(env, ownerId, planId, candidate, "departing");
      return "transferred";
    } catch (error) {
      if (error instanceof Error && /being deleted/.test(error.message)) continue;
      throw error;
    }
  }
  await destroyPlan(env, null, planId, ownerId);
  return "deleted";
}

export async function leavePlan(env: DurableBindings, userId: string, planId: string) {
  const plan = planObject(env, planId);
  const role = await plan.memberRole(userId);
  if (!role) {
    await userObject(env, userId).forgetPlan(planId);
    fail("not_found", "That plan doesn't exist, or isn't shared with you.");
  }
  if (role === "owner") return ownerDeparting(env, userId, planId);
  unwrapOutcome(await plan.removeMember(userId, userId));
  await userObject(env, userId).forgetPlan(planId);
  return "left" as const;
}

export async function removeMember(env: DurableBindings, ownerId: string, planId: string, userId: string) {
  if (ownerId === userId) return leavePlan(env, userId, planId);
  return unwrapOutcome(await planObject(env, planId).removeMember(ownerId, userId));
}

export async function setMemberRole(env: DurableBindings, ownerId: string, planId: string, userId: string, role: "editor" | "viewer") {
  return unwrapOutcome(await planObject(env, planId).setRole(ownerId, userId, role));
}

/**
 * Deletes a plan (owner only; final): every member's index forgets it with a notice, its links stop,
 * and the object's storage and alarm are wiped.
 */
export async function destroyPlan(env: DurableBindings, ownerId: string | null, planId: string, departingId?: string) {
  const plan = planObject(env, planId);
  const { members, codes, name } = unwrapOutcome(await plan.prepareDestroy(ownerId));
  await plan.destroy();
  const { linkObject } = await import("@/app/lib/durable/access");
  await Promise.all([
    ...members.map((member) =>
      userObject(env, member).forgetPlan(planId, member === ownerId || member === departingId ? undefined : `${name} was deleted by its owner.`).catch(() => undefined)
    ),
    ...codes.map((code) => linkObject(env, code).destroy().catch(() => undefined)),
  ]);
}

export async function setPlanAllowCopy(env: DurableBindings, userId: string, planId: string, allowCopy: boolean) {
  return unwrapOutcome(await planObject(env, planId).setAllowCopy(userId, allowCopy));
}
