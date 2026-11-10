// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, OPTIONS, POST } from "@/app/api/mcp/route";
import { consumeRequestBudget, resetRequestBudgets } from "@/app/lib/api/rate-limit";
import { clearTarkovResourceCache } from "@/app/lib/api/tarkov-server";
import { DEFAULT_MCP_LIMITS, handleMcpPost } from "@/app/lib/mcp/http";
import { MCP_TOOL_NAMES } from "@/app/lib/mcp/catalog";
import { parseSharedBuildInput } from "@/app/lib/builds/share-import";
import { decodePlanSharePayload } from "@/app/lib/raid-planner/share";
import { encodeBuildSharePayload } from "@/app/lib/builds/share";
import { decodeSharePayload } from "@/app/lib/share-codec";
import { parseBackup } from "@/app/lib/storage/backup";
import { createTarkovFixtures } from "./fixtures/tarkov";

let requestId = 0;
let fixtures: Record<string, unknown>;

function mcpRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "CF-Connecting-IP": "192.0.2.10",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(mcpRequest(body, headers));
}

async function rpc(method: string, params?: unknown) {
  requestId += 1;
  const response = await post({ jsonrpc: "2.0", id: requestId, method, ...(params ? { params } : {}) });
  return { response, body: await response.json() };
}

interface ToolResult {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc("tools/call", { name, arguments: args });
  const result = body.result as ToolResult;
  const data = (result.isError ? null : parseJson(result.content[0].text ?? "")) as any;
  if (data) expect(result.structuredContent).toEqual(data);
  const text = result.content.flatMap((entry) => (entry.text === undefined ? [] : [entry.text])).join("\n");
  return { result, text, data };
}

function hangUntilAborted(_input: unknown, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  });
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

beforeEach(() => {
  clearTarkovResourceCache();
  resetRequestBudgets();
  vi.stubEnv("CLIENT_IP_HEADER", "cf-connecting-ip");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  fixtures = createTarkovFixtures();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const resource = new URL(String(input)).pathname.split("/").pop()!;
    const fixture = fixtures[resource];
    if (!fixture) return new Response("missing fixture", { status: 404 });
    return new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MCP endpoint", () => {
  it("initialises with instructions and lists every catalogued tool", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.response.status).toBe(200);
    expect(init.response.headers.get("access-control-allow-origin")).toBeNull();
    expect(init.response.headers.get("cache-control")).toBe("no-store");
    expect(init.body.result.serverInfo).toMatchObject({ name: "eft-toolset", title: "EFT Toolset" });
    expect(init.body.result.instructions).toContain("gameMode");
    expect(init.body.result.instructions).toContain("flea buy and sell prices are the lowest current listing");

    const { body } = await rpc("tools/list");
    const names = (body.result.tools as { name: string; annotations?: { readOnlyHint?: boolean } }[]).map(
      (tool) => tool.name
    );
    expect(names.toSorted()).toEqual(MCP_TOOL_NAMES.toSorted());
    for (const tool of body.result.tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.idempotentHint).toBe(!tool.name.startsWith("create_"));
      expect(tool.outputSchema?.type).toBe("object");
    }

    const prompts = await rpc("prompts/list");
    expect(prompts.body.result.prompts.map((prompt: { name: string }) => prompt.name)).toEqual([
      "plan_raid",
      "build_weapon",
      "price_loot",
    ]);
  });

  it("searches items and returns item scanner details with links into the app", async () => {
    const search = await call("search_items", { query: "rifle" });
    expect(search.data.results[0]).toMatchObject({
      name: "Test Rifle",
      slug: "test-rifle",
      url: "http://localhost/item/test-rifle",
    });

    const item = await call("get_item", {
      item: "http://localhost/item/test-rifle",
      include: ["tasks", "barters", "crafts"],
    });
    expect(item.data).toMatchObject({
      name: "Test Rifle",
      size: "2x1",
      bestSell: { vendor: "Flea Market", priceRUB: 47_314, afterFleaFee: true, perSlotRUB: 23_657 },
      fleaListingFeeRUB: 2_686,
      cheapestBuy: { vendor: "Tester", priceRUB: 40_000, basis: "trader" },
    });
    expect(item.data.buyFrom).toContainEqual({
      vendor: "Flea Market",
      priceRUB: 50_000,
      basis: "lowest flea listing",
      avg24hRUB: 55_000,
    });
    expect(item.data.sellTo).toContainEqual({ vendor: "Flea Market", priceRUB: 50_000, basis: "lowest flea listing" });
    expect(item.data.usedInTasks[0]).toMatchObject({ name: "Test Task", trader: "Tester", minPlayerLevel: 10 });
    expect(item.data.barters[0]).toMatchObject({ give: ["2× Test Rifle"], receive: ["1× Reward"] });
    expect(item.data.crafts[0]).toMatchObject({ station: "Workbench", output: ["2× Reward"] });

    const counts = await call("get_item", { item: "weapon", include: [] });
    expect(counts.data).toMatchObject({ usedInTaskCount: 1, barterCount: 1, craftCount: 1 });

    const missing = await call("get_item", { item: "zzzz qqqq" });
    expect(missing.result.isError).toBe(true);
  });

  it("never reports a flea 24-hour average as the cheapest buy when listings are cheaper", async () => {
    // Water filter on PVP: a ₽60,000 lowest listing against a ₽102,539 24-hour average.
    const items = (fixtures.items as { data: { items: Record<string, Record<string, unknown>> } }).data.items;
    Object.assign(items.weapon, {
      lastLowPrice: 60_000,
      avg24hPrice: 102_539,
      buyFromTrader: [{ trader: "trader", priceRUB: 80_000, minTraderLevel: 1 }],
    });

    const item = await call("get_item", { item: "Test Rifle" });
    expect(item.data.cheapestBuy).toEqual({
      vendor: "Flea Market",
      priceRUB: 60_000,
      basis: "lowest flea listing",
      avg24hRUB: 102_539,
    });
    expect(item.data.buyFrom).toEqual([
      { vendor: "Flea Market", priceRUB: 60_000, basis: "lowest flea listing", avg24hRUB: 102_539 },
      { vendor: "Tester", priceRUB: 80_000, basis: "trader" },
    ]);

    const prices = await call("get_item_prices", { items: ["Test Rifle"] });
    expect(prices.data.rows[0].cheapestBuy).toMatchObject({ vendor: "Flea Market", priceRUB: 60_000 });

    // The gun builder keeps pricing the flea at the 24-hour average, and says so.
    const { body } = await rpc("tools/list");
    const ammoTool = body.result.tools.find((tool: { name: string }) => tool.name === "get_ammo_options");
    expect(ammoTool.outputSchema.properties.ammo.items.properties.fleaPriceRUB.description).toMatch(/24-hour average/);
  });

  it("prices item lists with counts, totals, and the Discord text the item groups page copies", async () => {
    const { data } = await call("get_item_prices", {
      items: [{ item: "Test Rifle", count: 2 }, "Test Mod", "zzzz qqqq"],
      includeDiscordText: true,
      groupName: "Loot",
    });
    expect(data.rows[0]).toMatchObject({ name: "Test Rifle", count: 2, totalRUB: 94_628, usedInTasks: ["Test Task"] });
    expect(data.unresolved).toEqual(["zzzz qqqq"]);
    expect(data.discordText).toContain("**Loot**");
    expect(data.discordText).toContain("2× Test Rifle");
  });

  it("builds, modifies, optimises, and shares guns with the builder's own logic", async () => {
    const weapon = await call("get_weapon", { weapon: "Rifle" });
    expect(weapon.data).toMatchObject({ id: "weapon", fireRate: 700, fireModes: ["Single fire"], defaultAmmo: "Test Ammo" });
    expect(weapon.data.slots).toEqual([
      { id: "slot", nameId: "mod_scope", name: "Scope", required: true, optionCount: 1 },
    ]);

    const preset = await call("evaluate_build", {
      build: { weapon: "Test Rifle", preset: "default", ammo: "Test Ammo" },
      includeShoppingList: true,
    });
    expect(preset.data.parts).toEqual([
      expect.objectContaining({ slotPath: ["slot"], slot: "Scope", name: "Test Mod" }),
    ]);
    expect(preset.data.stats).toMatchObject({ ergonomics: 48, partCount: 1, costRUB: 50_000 });
    expect(preset.data.ammo).toMatchObject({ name: "Test Ammo", fits: true });
    expect(preset.data.missingRequiredSlots).toEqual([]);
    expect(preset.data.shoppingList.totalRUB).toBe(50_000);
    const shared = await parseSharedBuildInput(preset.data.shareLink);
    expect(shared).toMatchObject({
      weaponId: "weapon",
      ammoId: "ammo",
      root: { itemId: "weapon", slots: { slot: { itemId: "mod", slots: {} } } },
    });

    const restated = await call("evaluate_build", {
      build: {
        weapon: "weapon",
        parts: preset.data.parts.map((part: { slotPath: string[]; itemId: string }) => ({
          slotPath: part.slotPath,
          item: part.itemId,
        })),
        ammo: "ammo",
      },
    });
    expect(restated.data.stats).toEqual(preset.data.stats);
    expect(restated.data.parts).toEqual(preset.data.parts);

    const removed = await call("modify_build", {
      build: { shareLink: preset.data.shareLink },
      changes: [{ action: "remove", slotPath: ["Scope"] }],
    });
    expect(removed.data.missingRequiredSlots).toEqual([
      { slot: "Scope", slotPath: ["slot"], optionCount: 1 },
    ]);

    const filled = await call("modify_build", {
      build: { shareLink: removed.data.shareLink },
      changes: [{ action: "fill_required" }, { action: "clear_ammo" }],
    });
    expect(filled.data.applied[0]).toMatch(/Filled empty required slots with 1 cheapest part/);
    expect(filled.data.parts).toEqual([expect.objectContaining({ slotPath: ["slot"], itemId: "mod" })]);
    expect(filled.data.ammoId).toBeNull();

    const installed = await call("modify_build", {
      build: { weapon: "weapon" },
      changes: [{ action: "install", slotPath: ["mod_scope"], item: "Mod" }],
    });
    expect(installed.data.applied).toEqual(["Installed Test Mod in Scope."]);

    const badSlot = await call("modify_build", {
      build: { weapon: "weapon" },
      changes: [{ action: "install", slotPath: ["Muzzle"], item: "Mod" }],
    });
    expect(badSlot.result.isError).toBe(true);
    expect(badSlot.text).toContain("has no slot");

    const missingItem = await call("modify_build", {
      build: { weapon: "weapon" },
      changes: [{ action: "install", slotPath: ["Scope"] }],
    });
    expect(missingItem.result.isError).toBe(true);
    expect(missingItem.text).toContain("changes[0].item");

    const optimised = await call("optimize_build", { build: { weapon: "weapon" }, goal: "ergonomics" });
    expect(optimised.data).toMatchObject({ changed: true, withinBudget: true });
    expect(optimised.data.changes).toEqual([
      { slot: "Scope", status: "added", before: null, after: "Test Mod" },
    ]);

    const options = await call("get_slot_options", { build: { weapon: "weapon" }, slotPath: ["slot"] });
    expect(options.data.options[0]).toMatchObject({ id: "mod", priceRUB: 10_000, trader: "Tester", conflict: null });

    const ammo = await call("get_ammo_options", { build: { weapon: "weapon" } });
    expect(ammo.data.ammo.map((entry: { id: string }) => entry.id)).toEqual(["ammo"]);

    const compared = await call("compare_builds", {
      left: { weapon: "weapon" },
      right: { shareLink: preset.data.shareLink },
    });
    expect(compared.data.slots).toEqual([{ slot: "Scope", status: "added", left: null, right: "Test Mod" }]);
    expect(compared.data.right.ammo).toBe("Test Ammo");
  });

  it("filters weapons by caliber before limiting name matches", async () => {
    const items = (fixtures.items as { data: { items: Record<string, unknown> } }).data.items;
    for (let index = 1; index <= 25; index += 1) {
      items[`ak-${index}`] = {
        id: `ak-${index}`,
        name: `AK test ${index}`,
        types: ["gun"],
        properties: {
          propertiesType: "ItemPropertiesWeapon",
          caliber: index === 25 ? "Caliber762x39" : "Caliber545x39",
        },
      };
    }
    const { data } = await call("list_weapons", { query: "AK", caliber: "7.62x39" });
    expect(data.total).toBe(1);
    expect(data.weapons).toEqual([
      { id: "ak-25", name: "AK test 25", shortName: "AK test 25", caliber: "762x39", hasDefaultPreset: false },
    ]);
    const all = await call("list_weapons", { query: "AK test", limit: 30 });
    expect(all.data.total).toBe(25);
    expect(all.data.nextOffset).toBeNull();

    const first = await call("list_weapons", { query: "AK test", limit: 10 });
    expect(first.data.nextOffset).toBe(10);
    const last = await call("list_weapons", { query: "AK test", limit: 10, offset: 20 });
    expect(last.data.weapons).toHaveLength(5);
    expect(last.data.nextOffset).toBeNull();

    const searchPage = await call("search_items", { query: "AK test", limit: 20, offset: 20 });
    expect(searchPage.data.results).toHaveLength(5);
    expect(searchPage.data.nextOffset).toBeNull();
    expect((await call("search_items", { query: "AK test", limit: 20 })).data.nextOffset).toBe(20);
  });

  it("reports invalid parts in shared builds instead of guessing", async () => {
    const shareLinkFor = async (root: { itemId: string; slots: Record<string, unknown> }) =>
      `http://localhost/gun-builder/share/x#b=${await encodeBuildSharePayload({
        id: "x",
        name: "Odd",
        weaponId: root.itemId,
        root: root as never,
        createdAt: 0,
        updatedAt: 0,
      })}`;
    const { data } = await call("evaluate_build", {
      build: { shareLink: await shareLinkFor({ itemId: "weapon", slots: { slot: { itemId: "ammo", slots: {} } } }) },
    });
    expect(data.warnings).toEqual(["Scope: ammo is not a known weapon part."]);
    const rejected = await call("evaluate_build", { build: { shareLink: await shareLinkFor({ itemId: "mod", slots: {} }) } });
    expect(rejected.result.isError).toBe(true);
    const mixed = await call("evaluate_build", { build: { weapon: "weapon", shareLink: "x", preset: "default" } });
    expect(mixed.result.isError).toBe(true);
    expect(mixed.text).toContain("A build is");
  });

  it("describes maps and creates plans from named places that open in the raid planner", async () => {
    const maps = await call("list_maps");
    expect(maps.data.maps.map((map: { key: string }) => map.key)).toContain("factory");

    const details = await call("get_map_details", { map: "Factory", sections: ["extracts", "locks"] });
    expect(details.data).toMatchObject({ players: "5-6", raidDurationMinutes: 20 });
    expect(details.data.extracts).toEqual([{ name: "Gate", faction: "pmc", x: 1, z: 3, y: 2, level: "Ground" }]);
    expect(details.data.locks[0]).toMatchObject({ key: "Test Key", keyUrl: "http://localhost/item/test-key" });
    expect(details.data.layers[0].options[0]).toEqual({ id: "extracts:pmc", label: "PMC", count: 1 });

    const created = await call("create_raid_plan", {
      map: "factory",
      name: "Gate run",
      route: [{ x: 1, z: 13 }, { place: "gate" }],
      notes: [{ at: { place: "Test Key" }, title: "Locked door", color: "blue" }],
    });
    expect(created.data).toMatchObject({ routeDistanceMeters: 10, layers: ["extracts:pmc"] });
    const payload = new URLSearchParams(created.data.shareLink.split("#")[1]).get("p")!;
    const plan = await decodePlanSharePayload(payload);
    expect(plan).toMatchObject({ name: "Gate run", mapKey: "factory" });
    expect(plan.route.map((waypoint) => waypoint.position)).toEqual([{ x: 1, z: 13 }, { x: 1, z: 3 }]);
    expect(plan.notes[0]).toMatchObject({ title: "Locked door", color: "#78b6d2", position: { x: 2, z: 4 } });

    const read = await call("read_raid_plan", { link: created.data.shareLink });
    expect(read.data.route[1]).toMatchObject({ step: 2, near: "Gate (pmc extract, 0 m)" });

    const coordinatesOnly = await call("create_raid_plan", {
      map: "factory",
      name: "Layers",
      route: [{ x: 1, z: 2 }],
      layers: ["extracts:pmc", "spawns:nowhere"],
    });
    expect(coordinatesOnly.data.layers).toEqual(["extracts:pmc"]);
    expect(coordinatesOnly.data.warnings).toEqual(["Left out layer ids this map does not have: spawns:nowhere."]);

    const ambiguous = await call("create_raid_plan", { map: "the moon", name: "x" });
    expect(ambiguous.result.isError).toBe(true);
  });

  it("bundles groups, builds, and plans into an import link the app's restore accepts", async () => {
    const plan = await call("create_raid_plan", { map: "factory", name: "Plan", route: [{ place: "Gate" }] });
    const { data } = await call("create_import_link", {
      itemGroups: [{ name: "Keep", items: ["Test Rifle", "test-mod", "zzzz qqqq"] }],
      builds: [{ weapon: "weapon", preset: "default", name: "Preset" }],
      raidPlans: [{ link: plan.data.shareLink }],
    });
    expect(data).toMatchObject({ itemGroups: 1, builds: 1, raidPlans: 1 });
    expect(data.notes).toEqual(['Keep: no item matches "zzzz qqqq", so it was left out.']);
    expect(data.importLink).toMatch(/^http:\/\/localhost\/data#import=/);
    const payload = new URLSearchParams(data.importLink.split("#")[1]).get("import")!;
    const restore = parseBackup(JSON.stringify(await decodeSharePayload(payload)));
    expect(restore.rejected).toEqual([]);
    expect(restore.entries.map((entry) => [entry.label, entry.count])).toEqual([
      ["Item groups", 1],
      ["Gun builds", 1],
      ["Raid plans", 1],
    ]);
    expect(restore.entries[0].incoming).toEqual([{ name: "Keep", items: ["Test Rifle", "Test Mod"] }]);
  });

  it("reports upstream outages as tool errors", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response("down", { status: 503 }));
    const { result, text } = await call("search_items", { query: "rifle" });
    expect(result.isError).toBe(true);
    expect(text).toMatch(/temporarily unavailable/);
  });

  it("enforces the HTTP contract", async () => {
    const plain = (method: string, headers: Record<string, string> = {}) =>
      new Request("http://localhost/api/mcp", { method, headers });
    expect(GET(plain("GET")).status).toBe(405);
    expect(DELETE(plain("DELETE")).status).toBe(405);
    const preflight = OPTIONS(plain("OPTIONS", { Origin: "http://localhost:6274" }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:6274");
    expect(preflight.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Mcp-Protocol-Version");
    expect(preflight.headers.get("vary")).toBe("Origin");
    const refused = OPTIONS(plain("OPTIONS", { Origin: "https://evil.example" }));
    expect(refused.status).toBe(403);
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();

    expect((await post("{not json")).status).toBe(400);
    expect((await post({ padding: "x".repeat(DEFAULT_MCP_LIMITS.maxRequestBytes + 1) })).status).toBe(413);
    const batch = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect(batch.status).toBe(400);
    expect((await batch.json()).error.message).toContain("one JSON-RPC message");
    const unsupported = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "Mcp-Protocol-Version": "zzz" });
    expect(unsupported.status).toBe(400);
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
  });

  it("accepts requests without an Origin, from this site, and from local tools, and rejects others", async () => {
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    expect((await post(ping, { Origin: "http://localhost" })).status).toBe(200);
    expect((await post(ping, { Origin: "http://localhost:6274" })).status).toBe(200);
    expect((await post(ping, { Origin: "https://www.eft-toolset.com" })).status).toBe(200);
    const refused = await post(ping, { Origin: "https://evil.example" });
    expect(refused.status).toBe(403);
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate limits each client by what its requests cost, apart from the website", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_970_000_000_000);
    const client = { "CF-Connecting-IP": "198.51.100.99" };
    const optimise = (id: number) =>
      post(
        {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "optimize_build", arguments: { build: { weapon: "weapon" }, goal: "cost" } },
        },
        client
      );
    // The optimiser costs 3 tokens, so 40 calls spend the client's 120.
    for (let id = 1; id <= 40; id += 1) expect((await optimise(id)).status).toBe(200);
    const limited = await post({ jsonrpc: "2.0", id: 41, method: "tools/list" }, client);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(consumeRequestBudget(new Request("http://localhost/api/tarkov", { headers: client })).allowed).toBe(true);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
  });

  it("keeps slow uploads from holding the website's body reads, and skips reading for clients over budget", async () => {
    const { POST: tarkovPost } = await import("@/app/api/tarkov/route");
    const slowBody = (streams: ReadableStreamDefaultController<Uint8Array>[]) =>
      ({
        body: new ReadableStream<Uint8Array>({ start: (controller) => void streams.push(controller) }),
        duplex: "half",
      }) as RequestInit;
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    // More slow MCP uploads than the website's cap of 32 body reads.
    const uploads = Array.from({ length: 40 }, (_, index) =>
      POST(
        new Request("http://localhost/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": `192.0.2.${index}` },
          ...slowBody(streams),
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(streams).toHaveLength(40);
    const website = await tarkovPost(
      new Request("http://localhost/api/tarkov", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.200" },
        body: JSON.stringify({ operation: "arbitrary.query", variables: {} }),
      })
    );
    expect(website.status).toBe(400);
    for (const controller of streams) controller.close();
    const statuses = (await Promise.all(uploads)).map((response) => response.status);
    expect(statuses.filter((status) => status === 429)).toHaveLength(24);

    vi.spyOn(Date, "now").mockReturnValue(1_980_000_000_000);
    const client = { "CF-Connecting-IP": "198.51.100.50" };
    // 480 pings at 0.25 tokens spend the client's 120.
    for (let id = 1; id <= 480; id += 1) expect((await post({ jsonrpc: "2.0", id, method: "ping" }, client)).status).toBe(200);
    const unread: ReadableStreamDefaultController<Uint8Array>[] = [];
    const limited = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...client },
        ...slowBody(unread),
      })
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
  });

  it("lets parallel tool calls near the limit use what is left of the budget", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_990_000_000_000);
    const client = { "CF-Connecting-IP": "198.51.100.60" };
    // 474 pings at 0.25 tokens leave 1.5 of the client's 120: enough for one tool call.
    for (let id = 1; id <= 474; id += 1) expect((await post({ jsonrpc: "2.0", id, method: "ping" }, client)).status).toBe(200);
    const responses = await Promise.all(
      [1, 2, 3, 4].map((id) =>
        post({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "list_maps", arguments: {} } }, client)
      )
    );
    expect(responses.map((response) => response.status).toSorted()).toEqual([200, 429, 429, 429]);
  });

  it("stops slow tools with a tool error and caps concurrent requests", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(hangUntilAborted);
    const limits = { ...DEFAULT_MCP_LIMITS, toolDeadlineMs: 100 };
    const callSearch = (id: number) =>
      handleMcpPost(
        mcpRequest({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "search_items", arguments: { query: "a" } } }),
        limits
      );
    const running = Array.from({ length: limits.maxConcurrentToolCalls }, (_, index) => callSearch(index + 1));
    const overflow = await callSearch(99);
    expect(overflow.status).toBe(429);
    expect(overflow.headers.get("retry-after")).toBe("1");
    const listed = await handleMcpPost(mcpRequest({ jsonrpc: "2.0", id: 100, method: "tools/list" }), limits);
    expect(listed.status).toBe(200);

    for (const [index, pending] of running.entries()) {
      const response = await pending;
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(index + 1);
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toContain("took too long");
    }
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
  });

  it("logs one line per tool call", async () => {
    await call("search_items", { query: "rifle", gameMode: "pve" });
    await call("get_item", { item: "zzzz qqqq" });
    const lines = vi
      .mocked(console.info)
      .mock.calls.map(([line]) => JSON.parse(String(line)))
      .filter((entry) => entry.event === "mcp_tool_call");
    expect(lines).toEqual([
      expect.objectContaining({ tool: "search_items", gameMode: "pve", outcome: "ok", stale: false }),
      expect.objectContaining({ tool: "get_item", gameMode: "regular", outcome: "input_error" }),
    ]);
  });

  it("flags cached data when tarkov.dev is down", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect((await call("search_items", { query: "rifle" })).data.dataNotice).toBeUndefined();
      expect((await call("get_item", { item: "Test Rifle" })).data.dataNotice).toBeUndefined();
      vi.setSystemTime(Date.now() + 31 * 60_000);
      vi.mocked(globalThis.fetch).mockImplementation(async () => new Response("down", { status: 503 }));
      const stale = await call("search_items", { query: "rifle" });
      expect(stale.data.results[0].name).toBe("Test Rifle");
      expect(stale.data.dataNotice).toMatch(/cached data from about 31 minutes ago/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects prompt arguments outside their choices", async () => {
    const valid = await rpc("prompts/get", { name: "price_loot", arguments: { items: "LEDX", gameMode: "pve" } });
    expect(valid.body.result.messages[0].content.text).toContain("in pve mode");
    const invalid = await rpc("prompts/get", { name: "price_loot", arguments: { items: "LEDX", gameMode: "arena" } });
    expect(invalid.body.error).toBeDefined();
  });
});
