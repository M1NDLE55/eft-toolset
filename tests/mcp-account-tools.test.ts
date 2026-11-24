// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcpPost as POST } from "./mcp-post";
import { clearTarkovResourceCache } from "@/app/lib/api/tarkov-server";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { setPlatform } from "@/app/lib/server/platform";
import { setWikiSnapshotDirectory } from "@/app/lib/wiki/snapshot";
import { planObject } from "@/app/lib/durable/access";
import { createTarkovFixtures } from "./fixtures/tarkov";
import { writeFixtureSnapshot } from "./fixtures/wiki";
import { durableEnv } from "./helpers/durable-env";

beforeAll(() => setWikiSnapshotDirectory(writeFixtureSnapshot()));

let durable: ReturnType<typeof durableEnv>;

beforeEach(() => {
  clearTarkovResourceCache();
  resetRequestBudgets();
  vi.stubEnv("DEV_AUTH", "1");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const fixtures = createTarkovFixtures();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const resource = new URL(String(input)).pathname.split("/").pop()!;
    const fixture = (fixtures as Record<string, unknown>)[resource];
    if (!fixture) return new Response("missing", { status: 404 });
    return new Response(JSON.stringify(fixture), { status: 200 });
  });
  durable = durableEnv();
  setPlatform({ durable: durable.env as never });
});

afterEach(() => {
  setPlatform();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** An MCP client signed in as a local test user ("Bearer dev:<name>", development only). */
async function agent(name: string) {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
    fetch: (async (url: string | URL, init?: RequestInit) => POST(new Request(url, init))) as typeof fetch,
    requestInit: { headers: { Authorization: `Bearer dev:${name}`, "User-Agent": "Knight/1.0" } },
  });
  const client = new Client({ name: "Knight", version: "1" });
  await client.connect(transport);
  return {
    async call<T = Record<string, unknown>>(tool: string, args: Record<string, unknown>): Promise<T> {
      const result = await client.callTool({ name: tool, arguments: args });
      if (result.isError) throw Object.assign(new Error((result.content as { text: string }[])[0].text), { meta: (result._meta as Record<string, unknown>)?.["eft-toolset/error"] });
      return result.structuredContent as T;
    },
    async fail(tool: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name: tool, arguments: args });
      expect(result.isError, `${tool} should fail`).toBe(true);
      return { message: (result.content as { text: string }[])[0].text, error: (result._meta as Record<string, { code: string; details?: Record<string, unknown> }>)["eft-toolset/error"] };
    },
  };
}

describe("library tools", () => {
  it("saves, lists, edits with versions, reports conflicts with both versions, and deletes", async () => {
    const knight = await agent("knight");
    const saved = await knight.call<{ id: string; version: number; url: string }>("save_to_library", { type: "build", build: { weapon: "weapon" }, name: "Agent build" });
    expect(saved).toMatchObject({ version: 1, url: expect.stringMatching(/\/gun-builder\/[A-Za-z0-9_-]{22}$/) });
    const library = await knight.call<{ builds: { id: string; version: number }[]; usage: { builds: number } }>("list_library", {});
    expect(library.builds).toEqual([expect.objectContaining({ id: saved.id, version: 1 })]);
    expect(library.usage.builds).toBe(1);

    const evaluated = await knight.call<{ shareLink: string }>("evaluate_build", { build: { savedBuildId: saved.id } });
    expect(evaluated.shareLink).toContain("#b=");
    const modified = await knight.call<{ saved: { version: number } }>("modify_build", { build: { savedBuildId: saved.id }, changes: [{ action: "install", slotPath: ["slot"], item: "mod" }], saveTo: { id: saved.id } });
    expect(modified.saved.version).toBe(2);

    // Same slot changed since version 1: a conflict, with the fields and both versions.
    const clash = await knight.fail("save_to_library", { type: "build", id: saved.id, baseVersion: 1, build: { weapon: "weapon" }, name: "Agent build" });
    expect(clash.error).toMatchObject({ code: "conflict", details: { fields: ["slot:slot"], theirs: { version: 2 } } });
    expect(await knight.fail("delete_from_library", { type: "build", id: saved.id, baseVersion: 1 })).toMatchObject({ error: { code: "conflict" } });
    expect(await knight.call("delete_from_library", { type: "build", id: saved.id, baseVersion: 2 })).toMatchObject({ done: true });
  });

  it("saves item groups with matched items, and retries safely with a requestId", async () => {
    const knight = await agent("knight");
    const first = await knight.call<{ id: string; itemMatches: { input: string; item: string | null }[] }>("save_to_library", { type: "item_group", name: "Loot", items: ["Test Rifle", "zzzz qqqq"], requestId: "req-1" });
    expect(first.itemMatches).toEqual([
      { input: "Test Rifle", item: "Test Rifle" },
      { input: "zzzz qqqq", item: null },
    ]);
    const again = await knight.call<{ id: string }>("save_to_library", { type: "item_group", name: "Loot", items: ["Test Rifle"], requestId: "req-1" });
    expect(again.id).toBe(first.id);
    const updated = await knight.call<{ version: number }>("save_to_library", { type: "item_group", id: first.id, baseVersion: 1, add: ["Test Mod"] });
    expect(updated.version).toBe(2);
  });

  it("shares a copy link another agent opens and copies, and needs sign-in for any of it", async () => {
    const knight = await agent("knight");
    const saved = await knight.call<{ id: string }>("save_to_library", { type: "build", build: { weapon: "weapon" }, name: "Shared" });
    const link = await knight.call<{ url: string }>("share_link", { type: "build", id: saved.id, access: "copy" });
    const other = await agent("rook");
    const opened = await other.call<{ kind: string; can: string[]; owner: string }>("open_link", { link: link.url });
    expect(opened).toMatchObject({ kind: "build", can: ["view", "copy"] });
    expect(opened.owner).toMatch(/^Scav-/);
    const copied = await other.call<{ id: string }>("copy_from_link", { link: link.url });
    expect(copied.id).not.toBe(saved.id);
    expect((await knight.call<{ links: { copies: number }[] }>("list_links", { type: "build", id: saved.id })).links[0].copies).toBe(1);
    await knight.call("revoke_link", { link: link.url });
    expect((await other.fail("open_link", { link: link.url })).message).toMatch(/revoked/);
  });
});

describe("live raid plan tools", () => {
  it("saves a plan, reads it with ids, edits it live with place names, and enforces roles", async () => {
    const knight = await agent("knight");
    const created = await knight.call<{ planId: string; planUrl: string; shareLink: string }>("create_raid_plan", { map: "factory", name: "Factory run", route: [{ place: "Gate" }], save: true });
    expect(created.planUrl).toContain(`/raid-planner/p/${created.planId}`);

    const read = await knight.call<{ rev: number; role: string; route: { id: string }[] }>("read_raid_plan", { link: created.planUrl });
    expect(read).toMatchObject({ rev: 0, role: "owner" });
    const edited = await knight.call<{ rev: number; created: { op: number; id: string }[] }>("edit_raid_plan", {
      plan: created.planId,
      ops: [
        { op: "add_waypoint", at: { x: 10, z: 10 }, insertAfter: read.route[0].id },
        { op: "add_note", at: { place: "Gate" }, title: "Exit here", body: "Bring the key" },
      ],
    });
    expect(edited.rev).toBe(1);
    expect(edited.created).toHaveLength(2);
    const noteId = edited.created[1].id;
    const notes = (await knight.call<{ notes: { id: string; textRev: number }[] }>("read_raid_plan", { link: created.planId })).notes;
    expect(notes.find((note) => note.id === noteId)?.textRev).toBe(1);
    await knight.call("edit_raid_plan", { plan: created.planId, ops: [{ op: "set_note_text", target: noteId, body: "No key needed", expectRev: 1 }] });
    // A second edit from the same stale revision is a conflict, not a silent overwrite.
    expect(await knight.fail("edit_raid_plan", { plan: created.planId, ops: [{ op: "set_note_text", target: noteId, body: "Stale", expectRev: 1 }] })).toMatchObject({ error: { code: "conflict" } });

    const invite = await knight.call<{ url: string }>("share_link", { type: "raid_plan", id: created.planId, access: "invite", role: "editor" });
    const rook = await agent("rook");
    expect(await rook.call("join_raid_plan", { invite: invite.url })).toMatchObject({ role: "editor" });
    const members = await knight.call<{ members: { name: string; key: string; role: string }[] }>("list_raid_plan_members", { plan: created.planId });
    const rookKey = members.members.find((member) => member.role === "editor")!.key;
    await knight.call("manage_raid_plan", { plan: created.planId, action: "set_role", member: rookKey, role: "viewer" });
    expect(await rook.fail("edit_raid_plan", { plan: created.planId, ops: [{ op: "rename", name: "Mine" }] })).toMatchObject({ error: { code: "forbidden" } });
    await knight.call("manage_raid_plan", { plan: created.planId, action: "transfer", member: rookKey });
    expect(await planObject(durable.env, created.planId).ownerId()).toBe("user_dev_rook");

    // Edits from MCP are attributed to the user, via AI, with the client's name.
    const snapshot = await planObject(durable.env, created.planId).snapshot("user_dev_rook");
    expect(snapshot.ok && snapshot.value.doc.notes[noteId].body).toBe("No key needed");
    expect(await rook.call("report_content", { plan: created.planId, reason: "other" }).catch((error: Error) => error.message)).toMatch(/your own plan/);
  });

  it("returns limit errors with the limit and usage", async () => {
    const knight = await agent("knight");
    for (let index = 0; index < 20; index += 1) await knight.call("create_raid_plan", { map: "factory", name: `P${index}`, save: true });
    const refused = await knight.fail("create_raid_plan", { map: "factory", name: "One more", save: true });
    expect(refused.error).toMatchObject({ code: "limit", retryable: false, details: { limit: 20, used: 20 } });
  });
});
