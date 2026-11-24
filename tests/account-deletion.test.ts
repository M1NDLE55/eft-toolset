// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform } from "@/app/lib/server/platform";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { planObject, userObject } from "@/app/lib/durable/access";
import { acceptInvite, applyPlanOps, createAccountPlan } from "@/app/lib/sharing/server/plan-service";
import { createLink, openShare } from "@/app/lib/sharing/server/link-routes";
import { runAccountDeletion } from "@/app/lib/sharing/server/account-deletion";
import { deleteAccount } from "@/app/lib/account/routes";
import { newOperationId, newRecordId } from "@/app/lib/sharing/ids";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import { durableEnv } from "./helpers/durable-env";

const ORIGIN = "http://localhost:3000";
const plan: PlanContent = { name: "Plan", mapKey: "customs", enabledLayers: [], route: [{ id: "w1", position: { x: 0, z: 0 } }], drawings: [], notes: [] };
const weapon = "5447a9cd4bdc2dbd208b4567";

let durable: ReturnType<typeof durableEnv>;
const env = () => durable.env;

async function invite(planId: string, owner: string, userId: string, role: "editor" | "viewer") {
  const code = (await createLink(env(), owner, { target: { type: "plan", id: planId }, access: "invite", role }, new Request(ORIGIN))).code;
  await acceptInvite(env(), userId, code);
}

beforeEach(() => {
  resetRequestBudgets();
  durable = durableEnv();
  setPlatform({ durable: durable.env as never });
});

afterEach(() => {
  setPlatform();
  vi.unstubAllEnvs();
});

describe("account deletion", () => {
  it("removes the library and links, hands on or deletes owned plans, leaves shared plans, and wipes the account", async () => {
    const leaving = "user_dev_leaving";
    const buildId = newRecordId();
    await userObject(env(), leaving).applyMutations([{ mutationId: newRecordId(), kind: "build", op: "create", id: buildId, value: { name: "B", weaponId: weapon, root: { itemId: weapon, slots: {} } } }]);
    const link = await createLink(env(), leaving, { target: { type: "build", id: buildId }, access: "view" }, new Request(ORIGIN));

    const handedOn = (await createAccountPlan(env(), leaving, plan, { kind: "create" })).planId;
    await invite(handedOn, leaving, "user_friend", "viewer");
    const solo = (await createAccountPlan(env(), leaving, plan, { kind: "create" })).planId;
    const theirs = (await createAccountPlan(env(), "user_other", plan, { kind: "create" })).planId;
    await invite(theirs, "user_other", leaving, "editor");
    await applyPlanOps(env(), { id: leaving, name: "", via: "web" }, theirs, newOperationId(), [{ t: "wp.add", id: "added", at: { x: 5, z: 5 }, ord: "x" }]);

    expect(await runAccountDeletion(env(), leaving)).toBe("done");

    await expect(openShare(env(), link.code, null)).rejects.toThrow();
    expect(await planObject(env(), handedOn).ownerId()).toBe("user_friend");
    expect((await userObject(env(), "user_friend").library()).notices[0].body).toMatch(/You now own Plan/);
    expect(await planObject(env(), solo).exists()).toBe(false);
    expect(await planObject(env(), theirs).memberRole(leaving)).toBeNull();
    // What they added to someone else's plan stays with that plan.
    const snapshot = await planObject(env(), theirs).snapshot("user_other");
    expect(snapshot.ok && Object.keys(snapshot.value.doc.waypoints)).toContain("added");
    // The account object is empty: a new sign-up would start fresh.
    expect((await userObject(env(), leaving).library()).records).toEqual([]);
  });

  it("is resumable: a failed step is retried and finished steps aren't repeated", async () => {
    const leaving = "user_dev_retry";
    const planId = (await createAccountPlan(env(), leaving, plan, { kind: "create" })).planId;
    await invite(planId, leaving, "user_friend", "editor");
    const friend = durable.USER.raw("user_friend") as unknown as { receiveOwnership: (...args: unknown[]) => Promise<unknown> };
    const original = friend.receiveOwnership.bind(friend);
    friend.receiveOwnership = async () => {
      throw new Error("temporarily unavailable");
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runAccountDeletion(env(), leaving)).toBe("pending");
    expect(durable.USER.state(leaving)?.alarm).not.toBeNull();
    // While it is being deleted, nothing new can be written or handed to it.
    const write = await userObject(env(), leaving).applyMutations([]);
    expect(write.ok).toBe(false);
    friend.receiveOwnership = original;
    expect(await runAccountDeletion(env(), leaving)).toBe("done");
    expect(await planObject(env(), planId).ownerId()).toBe("user_friend");
  });

  it("answers 202 from the route and signs the browser out", async () => {
    vi.stubEnv("DEV_AUTH", "1");
    const response = await deleteAccount(new Request(`${ORIGIN}/api/account`, { method: "DELETE", headers: { "sec-fetch-site": "same-origin", cookie: "eft_dev_user=gone" } }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ deleted: true, pending: false });
    expect(response.headers.getSetCookie().join("\n")).toMatch(/eft_session=;/);
  });
});
