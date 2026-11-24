// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform } from "@/app/lib/server/platform";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { acceptInvite, applyPlanOps, createAccountPlan, destroyPlan, removeMember, setMemberRole } from "@/app/lib/sharing/server/plan-service";
import { createLink, revokeLink } from "@/app/lib/sharing/server/link-routes";
import { planLive, shareLive } from "@/app/lib/sharing/server/live-routes";
import { PLAN_ACTOR_HEADER, PLAN_LINK_HEADER } from "@/app/lib/durable/plan-do";
import { newOperationId } from "@/app/lib/sharing/ids";
import type { PlanContent } from "@/app/lib/sharing/plan-content";
import { acceptedSockets, durableEnv, type FakeSocket } from "./helpers/durable-env";

const ORIGIN = "http://localhost:3000";
const content: PlanContent = {
  name: "Customs run",
  mapKey: "customs",
  enabledLayers: [],
  route: [{ id: "w1", position: { x: 1, z: 1 } }],
  drawings: [],
  notes: [{ id: "n1", position: { x: 2, z: 2 }, title: "Dorms", body: "Key", color: "#c8b384" }],
};

let durable: ReturnType<typeof durableEnv>;

async function plan() {
  const { planId } = await createAccountPlan(durable.env, "user_owner", content, { kind: "create" });
  const code = (await createLink(durable.env, "user_owner", { target: { type: "plan", id: planId }, access: "invite", role: "editor", maxUses: 10 }, new Request(ORIGIN))).code;
  await acceptInvite(durable.env, "user_editor", code);
  const viewerCode = (await createLink(durable.env, "user_owner", { target: { type: "plan", id: planId }, access: "invite", role: "viewer", maxUses: 10 }, new Request(ORIGIN))).code;
  await acceptInvite(durable.env, "user_viewer", viewerCode);
  return planId;
}

async function connect(planId: string, who: { actor?: string; link?: string }, since = -1): Promise<{ status: number; socket?: FakeSocket }> {
  const before = acceptedSockets.length;
  const headers: Record<string, string> = { Upgrade: "websocket" };
  if (who.actor) headers[PLAN_ACTOR_HEADER] = who.actor;
  if (who.link) headers[PLAN_LINK_HEADER] = who.link;
  const response = await durable.PLAN.raw(planId).fetch(new Request(`https://plan.internal/live?since=${since}`, { headers }));
  return { status: response.status, socket: acceptedSockets.length > before ? acceptedSockets[before] : undefined };
}

function send(planId: string, socket: FakeSocket, message: unknown) {
  return durable.PLAN.raw(planId).webSocketMessage(socket as never, JSON.stringify(message));
}

const types = (socket: FakeSocket) => socket.messages<{ type: string }>().map((message) => message.type);

beforeEach(() => {
  resetRequestBudgets();
  durable = durableEnv();
  setPlatform({ durable: durable.env as never });
});

afterEach(() => {
  setPlatform();
  vi.unstubAllEnvs();
});

describe("connecting", () => {
  it("sends members a snapshot with the member list and presence, and tells everyone who arrived", async () => {
    const planId = await plan();
    const owner = (await connect(planId, { actor: "user_owner" })).socket!;
    const snapshot = owner.last<{ you: { role: string }; members: unknown[]; presence: { name: string }[]; doc: { notes: Record<string, unknown> } }>("snapshot")!;
    expect(snapshot.you.role).toBe("owner");
    expect(snapshot.members).toHaveLength(3);
    expect(snapshot.doc.notes.n1).toBeTruthy();
    await connect(planId, { actor: "user_editor" });
    expect(owner.last<{ presence: unknown[] }>("presence")!.presence).toHaveLength(2);
    expect(JSON.stringify(owner.sent)).not.toContain("user_");
  });

  it("refuses non-members, and serves view-link holders without making them members or showing names", async () => {
    const planId = await plan();
    expect((await connect(planId, { actor: "user_stranger" })).status).toBe(404);
    const link = await createLink(durable.env, "user_owner", { target: { type: "plan", id: planId }, access: "view" }, new Request(ORIGIN));
    const anon = (await connect(planId, { link: link.code })).socket!;
    const snapshot = anon.last<Record<string, unknown>>("snapshot")!;
    expect(snapshot.you).toEqual({ role: "anonymous", key: null });
    expect(snapshot.members).toBeUndefined();
    expect(snapshot.presence).toEqual([]);
    expect(JSON.stringify(snapshot.doc)).not.toMatch(/"by":"[0-9a-f]/);
  });

  it("catches up a reconnect with the ops since its rev, or a snapshot when the log no longer reaches back", async () => {
    const planId = await plan();
    for (let index = 0; index < 3; index += 1) await applyPlanOps(durable.env, { id: "user_owner", name: "", via: "web" }, planId, newOperationId(), [{ t: "wp.move", id: "w1", at: { x: index, z: 0 } }]);
    const back = (await connect(planId, { actor: "user_editor" }, 1)).socket!;
    expect(types(back)).toEqual(["ops", "ops", "caught-up", "members", "presence"]);
    const fresh = (await connect(planId, { actor: "user_editor" }, 99)).socket!;
    expect(types(fresh)[0]).toBe("snapshot");
  });

  it("keeps at most 5 sockets per member (the oldest closes) and 200 anonymous viewers", async () => {
    const planId = await plan();
    const sockets = [];
    for (let index = 0; index < 6; index += 1) sockets.push((await connect(planId, { actor: "user_editor" })).socket!);
    expect(sockets[0].closed?.code).toBe(4008);
    expect(sockets.slice(1).every((socket) => !socket.closed)).toBe(true);
    const link = await createLink(durable.env, "user_owner", { target: { type: "plan", id: planId }, access: "view" }, new Request(ORIGIN));
    for (let index = 0; index < 200; index += 1) await connect(planId, { link: link.code });
    expect((await connect(planId, { link: link.code })).status).toBe(429);
  });
});

describe("editing live", () => {
  it("acks the sender and sends the ops to everyone else, anonymous viewers included", async () => {
    const planId = await plan();
    const editor = (await connect(planId, { actor: "user_editor" })).socket!;
    const owner = (await connect(planId, { actor: "user_owner" })).socket!;
    const link = await createLink(durable.env, "user_owner", { target: { type: "plan", id: planId }, access: "view" }, new Request(ORIGIN));
    const anon = (await connect(planId, { link: link.code })).socket!;
    await send(planId, editor, { type: "ops", opId: "op-aaaaaaaa", ops: [{ t: "wp.move", id: "w1", at: { x: 9, z: 9 } }] });
    expect(editor.last("ack")).toEqual({ type: "ack", opId: "op-aaaaaaaa", rev: 1 });
    expect(editor.messages<{ type: string }>().filter((message) => message.type === "ops")).toHaveLength(0);
    for (const socket of [owner, anon]) expect(socket.last("ops")).toMatchObject({ rev: 1, opId: "op-aaaaaaaa", actor: { via: "web" }, ops: [{ t: "wp.move", id: "w1" }] });
    // Anonymous viewers see what changed, never who changed it.
    expect(owner.last<{ actor: { name: string } }>("ops")!.actor.name).toMatch(/^Scav-/);
    expect(anon.last<{ actor: unknown }>("ops")!.actor).toEqual({ id: null, name: "", via: "web" });
    await send(planId, editor, { type: "preview", ops: [{ t: "wp.move", id: "w1", at: { x: 1, z: 1 } }] });
    expect(owner.last("preview")).toBeTruthy();
    expect(anon.last("preview")).toBeUndefined();
    // A re-sent op id is acknowledged without applying it again.
    await send(planId, editor, { type: "ops", opId: "op-aaaaaaaa", ops: [{ t: "wp.move", id: "w1", at: { x: 9, z: 9 } }] });
    expect(editor.last("ack")).toEqual({ type: "ack", opId: "op-aaaaaaaa", rev: 1 });
  });

  it("refuses viewers and view-link holders, and reports a note clash with the current text", async () => {
    const planId = await plan();
    const viewer = (await connect(planId, { actor: "user_viewer" })).socket!;
    await send(planId, viewer, { type: "ops", opId: "op-viewer1", ops: [{ t: "wp.del", id: "w1" }] });
    expect(viewer.last("reject")).toMatchObject({ code: "forbidden" });
    const editor = (await connect(planId, { actor: "user_editor" })).socket!;
    const owner = (await connect(planId, { actor: "user_owner" })).socket!;
    await send(planId, owner, { type: "ops", opId: "op-owner01", ops: [{ t: "note.text", id: "n1", field: "body", value: "Owner", base: 0 }] });
    await send(planId, editor, { type: "ops", opId: "op-editor1", ops: [{ t: "note.text", id: "n1", field: "body", value: "Editor", base: 0 }] });
    const reject = editor.last<{ code: string; details: { value: string; rev: number; byName: string } }>("reject")!;
    expect(reject).toMatchObject({ code: "conflict", details: { value: "Owner", rev: 1 } });
    expect(reject.details.byName).toMatch(/^Scav-/);
    expect(JSON.stringify(reject)).not.toContain("user_owner");
  });

  it("rate-limits each socket (20 batches a second, burst 60) and closes repeat offenders", async () => {
    const planId = await plan();
    const editor = (await connect(planId, { actor: "user_editor" })).socket!;
    for (let index = 0; index < 85; index += 1) await send(planId, editor, { type: "ops", opId: `op-burst-${index}`, ops: [{ t: "layer.on", layer: `l${index % 5}` }] });
    const rejected = editor.messages<{ type: string; code?: string }>().filter((message) => message.type === "reject" && message.code === "rate_limited");
    expect(rejected.length).toBeGreaterThan(10);
    expect(editor.closed?.code).toBe(4008);
  });

  it("broadcasts drag previews without storing them", async () => {
    const planId = await plan();
    const editor = (await connect(planId, { actor: "user_editor" })).socket!;
    const owner = (await connect(planId, { actor: "user_owner" })).socket!;
    await send(planId, editor, { type: "preview", ops: [{ t: "wp.move", id: "w1", at: { x: 3, z: 3 } }, { t: "wp.del", id: "w1" }] });
    expect(owner.last("preview")).toMatchObject({ ops: [{ t: "wp.move", id: "w1" }] });
    expect((await durable.PLAN.getByName(planId).summary()).ok).toBe(true);
    const summary = await durable.PLAN.getByName(planId).summary();
    expect(summary.ok && summary.value.rev).toBe(0);
  });

  it("shows an agent's edit to everyone, attributed and present as \"via AI\" for a minute", async () => {
    const planId = await plan();
    const owner = (await connect(planId, { actor: "user_owner" })).socket!;
    await applyPlanOps(durable.env, { id: "user_editor", name: "", via: "mcp", client: "Knight" }, planId, newOperationId(), [{ t: "note.color", id: "n1", color: "#d46b6b" }]);
    expect(owner.last("ops")).toMatchObject({ actor: { via: "mcp", client: "Knight" } });
    const presence = owner.last<{ presence: { via: string; client?: string; editing: string | null }[] }>("presence")!.presence;
    expect(presence).toContainEqual(expect.objectContaining({ via: "mcp", client: "Knight", editing: "note:n1" }));
  });

  it("shares what each member is editing, from their selection", async () => {
    const planId = await plan();
    const editor = (await connect(planId, { actor: "user_editor" })).socket!;
    const owner = (await connect(planId, { actor: "user_owner" })).socket!;
    await send(planId, editor, { type: "presence", editing: "note:n1", floor: null });
    expect(owner.last<{ presence: { editing: string | null }[] }>("presence")!.presence.map((entry) => entry.editing)).toContain("note:n1");
  });
});

describe("closing", () => {
  it("closes a removed member's sockets (4003), asks a re-roled member to reconnect (4009), and ends link and plan sockets", async () => {
    const planId = await plan();
    const viewer = (await connect(planId, { actor: "user_viewer" })).socket!;
    const editor = (await connect(planId, { actor: "user_editor" })).socket!;
    await removeMember(durable.env, "user_owner", planId, "user_viewer");
    expect(viewer.closed?.code).toBe(4003);
    // A last message says why, so clients act at once even if the close event lags behind.
    expect(viewer.last("closing")).toMatchObject({ code: 4003 });
    await setMemberRole(durable.env, "user_owner", planId, "user_editor", "viewer");
    expect(editor.closed?.code).toBe(4009);

    const link = await createLink(durable.env, "user_owner", { target: { type: "plan", id: planId }, access: "view" }, new Request(ORIGIN));
    const anon = (await connect(planId, { link: link.code })).socket!;
    await revokeLink(durable.env, "user_owner", link.code);
    expect(anon.closed?.code).toBe(4010);
    expect((await connect(planId, { link: link.code })).status).toBe(410);

    const owner = (await connect(planId, { actor: "user_owner" })).socket!;
    await destroyPlan(durable.env, "user_owner", planId);
    expect(owner.closed?.code).toBe(4004);
  });
});

describe("expiry", () => {
  it("closes anonymous viewers when their view link expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const planId = await plan();
      const link = await createLink(durable.env, "user_owner", { target: { type: "plan", id: planId }, access: "view", expiresIn: 1 }, new Request(ORIGIN));
      const anon = (await connect(planId, { link: link.code })).socket!;
      expect(durable.PLAN.state(planId)?.alarm).not.toBeNull();
      vi.setSystemTime(Date.now() + 24 * 60 * 60_000 + 1_000);
      await durable.runAlarms(Date.now());
      expect(anon.closed?.code).toBe(4010);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the Worker's upgrade routes", () => {
  it("require this site's Origin, a session for members, and a valid code for view links", async () => {
    vi.stubEnv("DEV_AUTH", "1");
    const planId = await plan();
    const upgrade = (path: string, headers: Record<string, string>) => new Request(`${ORIGIN}${path}`, { headers: { Upgrade: "websocket", ...headers } });
    expect((await planLive(upgrade(`/api/plans/${planId}/live`, { origin: "https://evil.example", cookie: "eft_dev_user=owner" }), planId)).status).toBe(403);
    expect((await planLive(upgrade(`/api/plans/${planId}/live`, { origin: ORIGIN }), planId)).status).toBe(401);
    // A client can't claim to be someone else: its x-eft-* headers are replaced.
    const spoofed = await planLive(upgrade(`/api/plans/${planId}/live`, { origin: ORIGIN, cookie: "eft_dev_user=stranger", [PLAN_ACTOR_HEADER]: "user_owner" }), planId);
    expect(spoofed.status).toBe(404);
    expect((await shareLive(upgrade(`/api/s/1aaaaaaaaaaaaaaaaaaaa/live`, { origin: ORIGIN }), "1aaaaaaaaaaaaaaaaaaaa")).status).toBe(404);
  });
});
