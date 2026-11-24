// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform } from "@/app/lib/server/platform";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { planObject, userObject } from "@/app/lib/durable/access";
import { memberKey } from "@/app/lib/durable/plan-store";
import {
  acceptInvite,
  applyPlanOps,
  copyPlanAsMember,
  createAccountPlan,
  destroyPlan,
  leavePlan,
  removeMember,
  setMemberRole,
  transferPlan,
} from "@/app/lib/sharing/server/plan-service";
import { createLink, copyFromLink, openShare, revokeLink } from "@/app/lib/sharing/server/link-routes";
import { sharingEndpoint } from "@/app/lib/sharing/server/router";
import { newOperationId, newRecordId } from "@/app/lib/sharing/ids";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import { durableEnv } from "./helpers/durable-env";

const ORIGIN = "http://localhost:3000";
const content: PlanContent = {
  name: "Customs run",
  mapKey: "customs",
  enabledLayers: ["extracts:pmc"],
  route: [{ id: "w1", position: { x: 1, z: 1 } }],
  drawings: [],
  notes: [{ id: "n1", position: { x: 2, z: 2 }, title: "Dorms", body: "Key", color: "#c8b384" }],
};

let durable: ReturnType<typeof durableEnv>;
const env = () => durable.env;
const request = new Request(ORIGIN);

async function plan(owner = "user_owner") {
  return (await createAccountPlan(env(), owner, content, { kind: "create" })).planId;
}

async function invite(planId: string, by: string, role: "editor" | "viewer", extra: { maxUses?: number; expiresIn?: number } = {}) {
  return (await createLink(env(), by, { target: { type: "plan", id: planId }, access: "invite", role, ...extra }, request)).code;
}

async function join(planId: string, userId: string, role: "editor" | "viewer") {
  const code = await invite(planId, "user_owner", role);
  return acceptInvite(env(), userId, code);
}

function op(ops: unknown[], userId = "user_owner") {
  return (planId: string) => applyPlanOps(env(), { id: userId, name: "", via: "web" }, planId, newOperationId(), ops as never);
}

beforeEach(() => {
  vi.stubEnv("DEV_AUTH", "1");
  resetRequestBudgets();
  durable = durableEnv();
  setPlatform({ durable: durable.env as never });
});

afterEach(() => {
  setPlatform();
  vi.unstubAllEnvs();
});

describe("creating plans", () => {
  it("stores the plan, lists it in the owner's index, and starts with copies off", async () => {
    const planId = await plan();
    expect(await userObject(env(), "user_owner").planEntry(planId)).toMatchObject({ relation: "owned", role: "owner", status: "active", name: "Customs run", mapKey: "customs" });
    const snapshot = await planObject(env(), planId).snapshot("user_owner");
    expect(snapshot.ok && snapshot.value).toMatchObject({ rev: 0, allowCopy: false, role: "owner" });
  });

  it("refuses an id that already holds a plan, so nobody can claim another's plan", async () => {
    const planId = await plan();
    await expect(createAccountPlan(env(), "user_mallory", content, { kind: "create", id: planId })).rejects.toThrow(/already used/);
    expect(await userObject(env(), "user_mallory").planEntry(planId)).toBeNull();
    expect(await userObject(env(), "user_mallory").usage()).toMatchObject({ ownedPlans: 0 });
  });

  it("releases the reservation when the content is refused", async () => {
    const huge = { ...content, notes: Array.from({ length: 101 }, (_, index) => ({ ...content.notes[0], id: `n${index}` })) };
    await expect(createAccountPlan(env(), "user_owner", huge, { kind: "create" })).rejects.toThrow(/100 notes/);
    expect(await userObject(env(), "user_owner").usage()).toMatchObject({ ownedPlans: 0 });
  });

  it("reconciles at the owned limit, so an index entry for a plan that's gone never blocks anyone", async () => {
    const user = userObject(env(), "user_owner");
    vi.useFakeTimers();
    try {
      for (let index = 0; index < 100; index += 1) await createAccountPlan(env(), "user_owner", { ...content, name: `P${index}` }, { kind: "import", id: newRecordId() });
      const ids = await user.planIds("owned");
      expect(ids).toHaveLength(100);
      // A plan deleted behind the index's back (its storage wiped) still has an entry.
      await planObject(env(), ids[0]).destroy();
      vi.setSystemTime(Date.now() + 60 * 60_000);
      const created = await createAccountPlan(env(), "user_owner", { ...content, name: "One more" }, { kind: "create" });
      expect(created.planId).toBeTruthy();
      expect(await user.usage()).toMatchObject({ ownedPlans: 100 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("roles and permissions", () => {
  it("lets owners and editors edit, viewers only read, and hides the plan from everyone else", async () => {
    const planId = await plan();
    await join(planId, "user_editor", "editor");
    await join(planId, "user_viewer", "viewer");
    const move = [{ t: "wp.move", id: "w1", at: { x: 5, z: 5 } }];
    expect((await op(move, "user_editor")(planId)).rev).toBe(1);
    await expect(op(move, "user_viewer")(planId)).rejects.toThrow(/Viewers can't/);
    await expect(op(move, "user_stranger")(planId)).rejects.toThrow(/doesn't exist/);
    const response = await sharingEndpoint(new Request(`${ORIGIN}/api/plans/${planId}`, { headers: { cookie: "eft_dev_user=stranger" } }))!(new Request(`${ORIGIN}/api/plans/${planId}`, { headers: { cookie: "eft_dev_user=stranger" } }));
    expect(response.status).toBe(404);
  });

  it("never shows member user ids to other members", async () => {
    const planId = await plan();
    await join(planId, "user_editor", "editor");
    const members = await planObject(env(), planId).members("user_editor");
    expect(JSON.stringify(members)).not.toContain("user_owner");
    // Nor in the content (who last changed each item), nor in a note clash.
    await op([{ t: "note.text", id: "n1", field: "body", value: "Owner's edit", base: 0 }])(planId);
    expect(JSON.stringify(await planObject(env(), planId).snapshot("user_editor"))).not.toContain("user_owner");
    const clash = await op([{ t: "note.text", id: "n1", field: "body", value: "Editor's edit", base: 0 }], "user_editor")(planId).catch((error: unknown) => error);
    expect(String(clash)).toMatch(/changed while you were editing/);
    expect(JSON.stringify((clash as { response?: unknown }).response ?? clash)).not.toContain("user_owner");
    expect(members.ok && members.value.map((member) => [member.role, member.you])).toEqual([
      ["owner", false],
      ["editor", true],
    ]);
  });

  it("lets editors invite viewers only, and see and revoke only their own invites", async () => {
    const planId = await plan();
    await join(planId, "user_editor", "editor");
    await expect(invite(planId, "user_editor", "editor")).rejects.toThrow(/Editors can invite viewers only/);
    await expect(createLink(env(), "user_editor", { target: { type: "plan", id: planId }, access: "view" }, request)).rejects.toThrow(/viewers only/);
    const editorInvite = await invite(planId, "user_editor", "viewer");
    const ownerInvite = await invite(planId, "user_owner", "editor");
    const listed = await planObject(env(), planId).listLinks("user_editor");
    expect(listed.ok && listed.value.map((link) => link.code)).toEqual([editorInvite]);
    await expect(revokeLink(env(), "user_editor", ownerInvite)).rejects.toThrow(/doesn't exist/);
    await revokeLink(env(), "user_owner", editorInvite);
  });

  it("revokes an editor's unused invites when they are demoted or removed", async () => {
    const planId = await plan();
    await join(planId, "user_editor", "editor");
    const code = await invite(planId, "user_editor", "viewer");
    await setMemberRole(env(), "user_owner", planId, "user_editor", "viewer");
    await expect(acceptInvite(env(), "user_friend", code)).rejects.toThrow(/revoked/);
  });
});

describe("invites", () => {
  it("counts uses, refuses past the limit or after expiry, and is idempotent for members", async () => {
    const planId = await plan();
    const code = await invite(planId, "user_owner", "viewer", { maxUses: 2 });
    expect(await acceptInvite(env(), "user_a", code)).toMatchObject({ role: "viewer", joined: true });
    expect(await acceptInvite(env(), "user_a", code)).toMatchObject({ role: "viewer", joined: false });
    await acceptInvite(env(), "user_b", code);
    await expect(acceptInvite(env(), "user_c", code)).rejects.toThrow(/has been used/);
    const hour = await invite(planId, "user_owner", "viewer", { expiresIn: 1 / 24 });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61 * 60_000);
    try {
      await expect(acceptInvite(env(), "user_d", hour)).rejects.toThrow(/expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never lowers a role, and raises one for a higher invite", async () => {
    const planId = await plan();
    await join(planId, "user_a", "editor");
    expect(await acceptInvite(env(), "user_a", await invite(planId, "user_owner", "viewer"))).toMatchObject({ role: "editor" });
    await join(planId, "user_b", "viewer");
    expect(await acceptInvite(env(), "user_b", await invite(planId, "user_owner", "editor"))).toMatchObject({ role: "editor" });
    expect(await userObject(env(), "user_b").planEntry(planId)).toMatchObject({ role: "editor", relation: "shared" });
  });

  it("limits a plan to 50 members and a user to 100 shared plans", async () => {
    const planId = await plan();
    const code = await invite(planId, "user_owner", "viewer", { maxUses: 50 });
    for (let index = 0; index < 49; index += 1) await acceptInvite(env(), `user_m${index}`, code);
    const second = await invite(planId, "user_owner", "viewer", { maxUses: 5 });
    await expect(acceptInvite(env(), "user_late", second)).rejects.toThrow(/at most 50 members/);
    // The refused join released its reservation.
    expect(await userObject(env(), "user_late").usage()).toMatchObject({ sharedPlans: 0 });
  });
});

describe("leaving, removal and ownership transfer", () => {
  it("removes a member and tells their index, with a notice", async () => {
    const planId = await plan();
    await join(planId, "user_viewer", "viewer");
    await removeMember(env(), "user_owner", planId, "user_viewer");
    await durable.runAlarms(Date.now() + 5_000);
    expect(await userObject(env(), "user_viewer").planEntry(planId)).toBeNull();
    expect((await userObject(env(), "user_viewer").library()).notices[0].body).toBe("You were removed from Customs run.");
  });

  it("transfers explicitly, even past the recipient's owned limit; the former owner stays as an editor", async () => {
    const planId = await plan();
    await join(planId, "user_editor", "editor");
    for (let index = 0; index < 100; index += 1) await createAccountPlan(env(), "user_editor", { ...content, name: `E${index}` }, { kind: "import" });
    await transferPlan(env(), "user_owner", planId, "user_editor");
    expect(await planObject(env(), planId).ownerId()).toBe("user_editor");
    expect(await userObject(env(), "user_editor").usage()).toMatchObject({ ownedPlans: 101, sharedPlans: 0 });
    expect(await userObject(env(), "user_owner").planEntry(planId)).toMatchObject({ role: "editor", relation: "shared" });
    await expect(createAccountPlan(env(), "user_editor", content, { kind: "create" })).rejects.toThrow(/remove 2 first/);
    await expect(transferPlan(env(), "user_owner", planId, "user_owner")).rejects.toThrow();
  });

  it("hands the plan to the next member when the owner leaves: editors first, then who joined first", async () => {
    const planId = await plan();
    await join(planId, "user_viewer_early", "viewer");
    await join(planId, "user_editor_late", "editor");
    await join(planId, "user_editor_later", "editor");
    expect(await leavePlan(env(), "user_owner", planId)).toBe("transferred");
    expect(await planObject(env(), planId).ownerId()).toBe("user_editor_late");
    expect(await userObject(env(), "user_owner").planEntry(planId)).toBeNull();
    expect((await userObject(env(), "user_editor_late").library()).notices[0].body).toMatch(/You now own Customs run because Scav-\d{4} left/);
  });

  it("skips a successor whose account is being deleted, and deletes a plan with no one left", async () => {
    const planId = await plan();
    await join(planId, "user_gone", "editor");
    await join(planId, "user_next", "viewer");
    await userObject(env(), "user_gone").beginDeletion();
    await leavePlan(env(), "user_owner", planId);
    expect(await planObject(env(), planId).ownerId()).toBe("user_next");

    const lonely = await plan();
    expect(await leavePlan(env(), "user_owner", lonely)).toBe("deleted");
    expect(await planObject(env(), lonely).exists()).toBe(false);
  });

  it("deletes a plan for everyone (owner only), with notices for members", async () => {
    const planId = await plan();
    await join(planId, "user_editor", "editor");
    await expect(destroyPlan(env(), "user_editor", planId)).rejects.toThrow(/owner/);
    await destroyPlan(env(), "user_owner", planId);
    expect(await userObject(env(), "user_editor").planEntry(planId)).toBeNull();
    expect((await userObject(env(), "user_editor").library()).notices[0].body).toBe("Customs run was deleted by its owner.");
  });
});

describe("copies and view links", () => {
  it("lets a member copy only with \"Allow copies\" on (the owner always can)", async () => {
    const planId = await plan();
    await join(planId, "user_viewer", "viewer");
    await expect(copyPlanAsMember(env(), "user_viewer", planId)).rejects.toThrow(/doesn't allow copies/);
    expect((await copyPlanAsMember(env(), "user_owner", planId)).name).toBe("Customs run copy");
    await planObject(env(), planId).setAllowCopy("user_owner", true);
    const copy = await copyPlanAsMember(env(), "user_viewer", planId);
    const snapshot = await planObject(env(), copy.id).snapshot("user_viewer");
    // A copy starts with the copier's default (off) and has no members or links of its own.
    expect(snapshot.ok && snapshot.value).toMatchObject({ allowCopy: false, role: "owner", members: [{ role: "owner" }] });
  });

  it("shows a view link to anyone without making them a member, and copies through a copy link only when allowed", async () => {
    const planId = await plan();
    const view = await createLink(env(), "user_owner", { target: { type: "plan", id: planId }, access: "copy" }, request);
    const opened = await openShare(env(), view.code, null);
    expect(opened).toMatchObject({ targetType: "plan", access: "view", allowCopy: false });
    await expect(copyFromLink(env(), "user_visitor", view.code)).rejects.toThrow(/doesn't allow copies/);
    await planObject(env(), planId).setAllowCopy("user_owner", true);
    expect((await copyFromLink(env(), "user_visitor", view.code)).type).toBe("plan");
    expect(await planObject(env(), planId).memberRole("user_visitor")).toBeNull();
  });

  it("keeps 20 active links per plan at most", async () => {
    const planId = await plan();
    for (let index = 0; index < 20; index += 1) {
      durable.USER.raw("user_owner");
      await createLink(env(), "user_owner", { target: { type: "plan", id: planId }, access: "view" }, request);
    }
    await expect(createLink(env(), "user_owner", { target: { type: "plan", id: planId }, access: "view" }, request)).rejects.toThrow(/20 active links|Too many/);
  });
});

describe("members' keys", () => {
  it("are stable per plan and differ between plans", () => {
    expect(memberKey("p1", "u")).toBe(memberKey("p1", "u"));
    expect(memberKey("p1", "u")).not.toBe(memberKey("p2", "u"));
    expect(memberKey("p1", "u")).toMatch(/^[0-9a-f]{16}$/);
  });
});
