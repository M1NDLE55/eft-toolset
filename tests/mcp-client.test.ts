// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { POST } from "@/app/api/mcp/route";
import { clearTarkovResourceCache } from "@/app/lib/api/tarkov-server";
import { MCP_TOOL_NAMES } from "@/app/lib/mcp/catalog";
import { createTarkovFixtures } from "./fixtures/tarkov";

beforeEach(() => {
  clearTarkovResourceCache();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const fixtures = createTarkovFixtures();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const resource = new URL(String(input)).pathname.split("/").pop()!;
    const fixture = (fixtures as Record<string, unknown>)[resource];
    if (!fixture) return new Response("missing", { status: 404 });
    return new Response(JSON.stringify(fixture), { status: 200 });
  });
});

it("serves every tool to the SDK client, whose output validation accepts each result", async () => {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
    fetch: (async (url: string | URL, init?: RequestInit) => POST(new Request(url, init))) as typeof fetch,
  });
  const client = new Client({ name: "t", version: "1" });
  await client.connect(transport);
  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name).toSorted()).toEqual(MCP_TOOL_NAMES.toSorted());
  const calls: [string, Record<string, unknown>][] = [
    ["search_items", { query: "rifle" }],
    ["get_item", { item: "Test Rifle" }],
    ["get_item_prices", { items: ["Test Rifle"] }],
    ["list_weapons", {}],
    ["get_weapon", { weapon: "weapon" }],
    ["get_slot_options", { build: { weapon: "weapon" }, slotPath: ["slot"] }],
    ["evaluate_build", { build: { weapon: "weapon", parts: [{ slotPath: ["slot"], item: "mod" }], ammo: "ammo" } }],
    ["get_ammo_options", { build: { weapon: "weapon" } }],
    ["evaluate_build", { build: { weapon: "weapon", preset: "default" }, includeShoppingList: true }],
    ["modify_build", { build: { weapon: "weapon" }, changes: [{ action: "fill_required" }] }],
    ["optimize_build", { build: { weapon: "weapon" }, goal: "recoil" }],
    ["compare_builds", { left: { weapon: "weapon" }, right: { weapon: "weapon", preset: "default" } }],
    ["list_maps", {}],
    ["get_map_details", { map: "factory" }],
    ["create_raid_plan", { map: "factory", name: "x", route: [{ place: "Gate" }] }],
    ["create_import_link", { itemGroups: [{ name: "a", items: ["Test Rifle"] }] }],
    // Optional output branches.
    ["get_item", { item: "Test Rifle", include: ["tasks", "barters", "crafts"] }],
    ["get_item", { item: "rifle", include: [] }],
    ["get_item_prices", { items: ["Test Rifle", { item: "Test Mod", count: 3 }, "zzzz qqqq"], includeDiscordText: true, sortBy: "perSlot" }],
    ["get_map_details", { map: "factory", sections: ["spawns", "locks", "lootContainers"], lootContainerTypes: ["safe"] }],
    ["evaluate_build", { build: { weapon: "weapon", preset: "default", ammo: "Test Ammo" }, includeDiscordText: true }],
    ["optimize_build", { build: { weapon: "weapon" }, goal: "ergonomics", budgetRUB: 1 }],
    ["modify_build", { build: { weapon: "weapon" }, changes: [{ action: "set_ammo", item: "Test Ammo" }, { action: "clear_ammo" }] }],
    ["get_ammo_options", { build: { weapon: "weapon", preset: "default" }, sortBy: "price", limit: 1 }],
    ["create_raid_plan", { map: "factory", name: "y", layers: ["extracts:pmc", "nope"], notes: [{ at: { x: 1, z: 2 }, title: "n" }] }],
  ];
  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
    expect(result.structuredContent, name).toBeTruthy();
  }
  const plan = await client.callTool({ name: "create_raid_plan", arguments: { map: "factory", name: "x" } });
  const link = (plan.structuredContent as { shareLink: string }).shareLink;
  const read = await client.callTool({ name: "read_raid_plan", arguments: { link } });
  expect(read.isError).toBeFalsy();
  await client.close();
});
