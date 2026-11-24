// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform } from "@/app/lib/server/platform";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { planObject } from "@/app/lib/durable/access";
import { DomainError } from "@/app/lib/durable/sql";
import { acceptInvite, applyPlanOps, createAccountPlan, removeMember } from "@/app/lib/sharing/server/plan-service";
import { createLink } from "@/app/lib/sharing/server/link-routes";
import { openAccountDb } from "@/app/lib/account-sync/idb";
import { PlanSession, createAccountPlanLocally, type PlanTransport, type SendResult } from "@/app/lib/account-sync/plan-session";
import { readPlan } from "@/app/lib/account-sync/plan-cache";
import { newOperationId } from "@/app/lib/sharing/ids";
import type { AccountLibrary } from "@/app/lib/account-sync/account-library";
import type { RaidPlan } from "@/app/lib/raid-planner/types";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import { durableEnv } from "./helpers/durable-env";

const content: PlanContent = {
  name: "Customs run",
  mapKey: "customs",
  enabledLayers: [],
  route: [
    { id: "w1", position: { x: 1, z: 1 } },
    { id: "w2", position: { x: 2, z: 2 } },
  ],
  drawings: [],
  notes: [{ id: "n1", position: { x: 5, z: 5 }, title: "Dorms", body: "Key in 314", color: "#c8b384" }],
};

let durable: ReturnType<typeof durableEnv>;
let dbCounter = 0;

/** A device: its own account cache, talking to the real PlanDO through the plan service, with a network switch. */
async function device(userId: string) {
  const db = await openAccountDb(`test-${(dbCounter += 1)}`);
  const state = { online: true };
  const library = { database: db, reloadPlans: async () => undefined, request: async () => new Response(null, { status: 500 }) } as unknown as AccountLibrary;
  const transport = (planId: string): PlanTransport => ({
    async send(batch, knownRev): Promise<SendResult> {
      if (!state.online) return { kind: "offline" };
      try {
        const result = await applyPlanOps(durable.env, { id: userId, name: "", via: "web" }, planId, batch.opId, batch.ops, knownRev);
        return { kind: "ack", rev: result.rev, catchUp: result.catchUp as never };
      } catch (error) {
        const domain = error instanceof DomainError ? error : null;
        const body = domain ? null : ((await (error as { response?: Response }).response?.json()) as { error: { code: string; message: string; details?: Record<string, unknown> } });
        return { kind: "reject", code: (domain?.code ?? body?.error.code) as never, message: domain?.message ?? body?.error.message ?? "", details: domain?.details ?? body?.error.details };
      }
    },
    async fetch(since) {
      if (!state.online) return null;
      const plan = planObject(durable.env, planId);
      const result = since === null ? await plan.snapshot(userId).then((value) => (value.ok ? { ok: true as const, value: { snapshot: value.value } } : value)) : await plan.since(userId, since);
      if (!result.ok) return { lost: result.error.message };
      return result.value as never;
    },
    async create(planContent) {
      if (!state.online) return { ok: false, code: "offline", message: "offline" };
      try {
        await createAccountPlan(durable.env, userId, planContent, { kind: "create", id: planId });
        return { ok: true };
      } catch (error) {
        return { ok: false, code: "limit", message: (error as Error).message };
      }
    },
    close() {},
  });
  return {
    state,
    library,
    db,
    async open(planId: string) {
      const session = new PlanSession(library, planId, transport(planId));
      await session.open({ poll: false });
      return session;
    },
  };
}

function edit(session: PlanSession, change: (plan: RaidPlan) => RaidPlan) {
  const plan = session.view().plan!;
  return session.edit(change(plan));
}

async function settle(session: PlanSession) {
  await session.flush();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await session.flush();
}

const op = (userId: string, planId: string, ops: unknown[]) => applyPlanOps(durable.env, { id: userId, name: "", via: "web" }, planId, newOperationId(), ops as never);

async function sharedPlan() {
  const { planId } = await createAccountPlan(durable.env, "user_owner", content, { kind: "create" });
  const code = (await createLink(durable.env, "user_owner", { target: { type: "plan", id: planId }, access: "invite", role: "editor", maxUses: 5 }, new Request("http://localhost"))).code;
  await acceptInvite(durable.env, "user_editor", code);
  return planId;
}

beforeEach(() => {
  resetRequestBudgets();
  durable = durableEnv();
  setPlatform({ durable: durable.env as never });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  setPlatform();
  vi.restoreAllMocks();
});

describe("plan sessions", () => {
  it("queues edits offline and replays them in order when back online", async () => {
    const planId = await sharedPlan();
    const editor = await device("user_editor");
    const session = await editor.open(planId);
    editor.state.online = false;
    expect(edit(session, (plan) => ({ ...plan, route: [...plan.route, { id: "w3", position: { x: 3, z: 3 } }] }))).toBeNull();
    expect(edit(session, (plan) => ({ ...plan, notes: [...plan.notes, { id: "n2", position: { x: 0, z: 0 }, title: "Extract", body: "", color: "#c8b384" }] }))).toBeNull();
    await settle(session);
    expect(session.view()).toMatchObject({ queued: 2, online: false });
    expect(session.view().plan!.route.map((waypoint) => waypoint.id)).toEqual(["w1", "w2", "w3"]);

    editor.state.online = true;
    await session.refresh();
    await settle(session);
    expect(session.view().queued).toBe(0);
    const server = await planObject(durable.env, planId).snapshot("user_owner");
    expect(server.ok && Object.keys(server.value.doc.waypoints).sort()).toEqual(["w1", "w2", "w3"]);
    expect(server.ok && server.value.rev).toBe(2);
  });

  it("refuses an offline action that would break a cap, with the server's message", async () => {
    const planId = await sharedPlan();
    const session = await (await device("user_owner")).open(planId);
    // 99 new notes in one action: more than one batch can carry, so it goes as several.
    const notes = Array.from({ length: 99 }, (_, index) => ({ id: `x${index}`, position: { x: 0, z: 0 }, title: "", body: "", color: "#c8b384" }));
    expect(edit(session, (plan) => ({ ...plan, notes: [...plan.notes, ...notes] }))).toBeNull();
    expect(session.view().queued).toBe(2);
    expect(edit(session, (plan) => ({ ...plan, notes: [...plan.notes, { ...notes[0], id: "one-too-many" }] }))).toMatch(/already has 100 notes/);
  });

  it("lets a delete by someone else stand, and lists the offline edit under Couldn't apply with Add it back", async () => {
    const planId = await sharedPlan();
    const editor = await device("user_editor");
    const session = await editor.open(planId);
    editor.state.online = false;
    edit(session, (plan) => ({ ...plan, route: plan.route.map((waypoint) => (waypoint.id === "w2" ? { ...waypoint, position: { x: 20, z: 20 } } : waypoint)) }));
    await op("user_owner", planId, [{ t: "wp.del", id: "w2" }]);
    editor.state.online = true;
    await session.refresh();
    await settle(session);
    const [issue] = session.view().issues;
    expect(issue).toMatchObject({ kind: "gone", message: expect.stringMatching(/which someone deleted/) });
    expect(issue.restore).toEqual([expect.objectContaining({ t: "wp.add", at: { x: 20, z: 20 } })]);
    await session.addBack(issue.opId);
    await settle(session);
    const server = await planObject(durable.env, planId).snapshot("user_owner");
    const waypoints = server.ok ? Object.values(server.value.doc.waypoints) : [];
    expect(waypoints.map((waypoint) => [waypoint.x, waypoint.id === "w2"])).toEqual(expect.arrayContaining([[20, false]]));
    expect(session.view().issues).toEqual([]);
  });

  it("asks about a note edited elsewhere: Keep mine, Keep theirs or Keep both", async () => {
    for (const choice of ["mine", "theirs", "both"] as const) {
      const planId = await sharedPlan();
      const editor = await device("user_editor");
      const session = await editor.open(planId);
      editor.state.online = false;
      edit(session, (plan) => ({ ...plan, notes: plan.notes.map((note) => ({ ...note, body: "Editor's text" })) }));
      await op("user_owner", planId, [{ t: "note.text", id: "n1", field: "body", value: "Owner's text", base: 0 }]);
      editor.state.online = true;
      await session.refresh();
      await settle(session);
      expect(session.view().conflict).toMatchObject({ mine: "Editor's text", theirs: "Owner's text", field: "body" });
      await session.resolveConflict(choice);
      await settle(session);
      const server = await planObject(durable.env, planId).snapshot("user_owner");
      const notes = server.ok ? Object.values(server.value.doc.notes) : [];
      if (choice === "mine") expect(notes.map((note) => note.body)).toEqual(["Editor's text"]);
      if (choice === "theirs") expect(notes.map((note) => note.body)).toEqual(["Owner's text"]);
      if (choice === "both") expect(notes.map((note) => `${note.title}: ${note.body}`).sort()).toEqual(["Dorms (my version): Editor's text", "Dorms: Owner's text"]);
    }
  });

  it("says when an offline edit replaced a newer change by someone else (last to reach the server wins)", async () => {
    const planId = await sharedPlan();
    const editor = await device("user_editor");
    const session = await editor.open(planId);
    editor.state.online = false;
    edit(session, (plan) => ({ ...plan, route: plan.route.map((waypoint) => (waypoint.id === "w1" ? { ...waypoint, position: { x: 9, z: 9 } } : waypoint)) }));
    await op("user_owner", planId, [{ t: "wp.move", id: "w1", at: { x: 50, z: 50 } }]);
    editor.state.online = true;
    await session.refresh();
    await settle(session);
    expect(session.view().notices.map((notice) => notice.text)).toEqual([expect.stringMatching(/Your offline move of waypoint 1 replaced a newer change by Scav-\d{4}/)]);
    const server = await planObject(durable.env, planId).snapshot("user_owner");
    expect(server.ok && server.value.doc.waypoints.w1).toMatchObject({ x: 9, z: 9 });
  });

  it("keeps an offline copy when access is lost; with copies off, only the user's own additions", async () => {
    for (const allowCopy of [false, true]) {
      const planId = await sharedPlan();
      await planObject(durable.env, planId).setAllowCopy("user_owner", allowCopy);
      const editor = await device("user_editor");
      const session = await editor.open(planId);
      editor.state.online = false;
      edit(session, (plan) => ({ ...plan, notes: [...plan.notes, { id: "mine", position: { x: 1, z: 1 }, title: "My note", body: "", color: "#c8b384" }] }));
      await removeMember(durable.env, "user_owner", planId, "user_editor");
      editor.state.online = true;
      await session.refresh();
      await settle(session);
      const copy = session.view().offlineCopy!;
      expect(copy.reason).toMatch(/doesn't exist|isn't shared/);
      expect(Object.keys(copy.doc.notes).sort()).toEqual(allowCopy ? ["mine", "n1"] : ["mine"]);
      expect(Object.keys(copy.doc.waypoints)).toHaveLength(allowCopy ? 2 : 0);
      // The original is gone from the cache; only the copy is kept.
      expect((await readPlan(editor.db, planId))?.state).toBeUndefined();
    }
  });

  it("undoes only this user's own change, leaving others' edits alone", async () => {
    const planId = await sharedPlan();
    const owner = await (await device("user_owner")).open(planId);
    edit(owner, (plan) => ({ ...plan, route: plan.route.map((waypoint) => (waypoint.id === "w1" ? { ...waypoint, position: { x: 7, z: 7 } } : waypoint)) }));
    await settle(owner);
    await op("user_editor", planId, [{ t: "wp.move", id: "w2", at: { x: 40, z: 40 } }]);
    await owner.refresh();
    owner.undo();
    await settle(owner);
    const server = await planObject(durable.env, planId).snapshot("user_owner");
    expect(server.ok && server.value.doc.waypoints.w1).toMatchObject({ x: 1, z: 1 });
    expect(server.ok && server.value.doc.waypoints.w2).toMatchObject({ x: 40, z: 40 });
    owner.redo();
    await settle(owner);
    const again = await planObject(durable.env, planId).snapshot("user_owner");
    expect(again.ok && again.value.doc.waypoints.w1).toMatchObject({ x: 7, z: 7 });
  });

  it("creates a plan made offline under its client id when back online", async () => {
    const owner = await device("user_owner");
    owner.state.online = false;
    const planId = await createAccountPlanLocally(owner.library, { ...content, route: [] });
    const session = await owner.open(planId);
    edit(session, (plan) => ({ ...plan, route: [{ id: "a", position: { x: 1, z: 2 } }] }));
    await settle(session);
    expect(session.view()).toMatchObject({ pendingCreate: true, queued: 1 });
    owner.state.online = true;
    await session.refresh();
    await settle(session);
    expect(session.view()).toMatchObject({ pendingCreate: false, queued: 0 });
    const server = await planObject(durable.env, planId).snapshot("user_owner");
    expect(server.ok && Object.keys(server.value.doc.waypoints)).toEqual(["a"]);
  });
});
