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
    const priceLoot = await rpc("prompts/get", { name: "price_loot", arguments: { items: "LEDX" } });
    expect(priceLoot.body.result.messages[0].content.text).toContain("still needed for tasks or hideout upgrades");
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
      // A weapon's size depends on its attachments, so it has no per-slot value.
      bestSell: { vendor: "Flea Market", priceRUB: 47_314, afterFleaFee: true, perSlotRUB: null },
      sizeNote: expect.stringContaining("stripped weapon"),
      fleaListingFeeRUB: 2_686,
      cheapestBuy: { vendor: "Tester", priceRUB: 40_000, basis: "trader", loyaltyLevel: 3 },
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
      { vendor: "Tester", priceRUB: 80_000, basis: "trader", loyaltyLevel: 1 },
    ]);

    const prices = await call("get_item_prices", { items: ["Test Rifle"] });
    expect(prices.data.rows[0].cheapestBuy).toMatchObject({ vendor: "Flea Market", priceRUB: 60_000 });

    // The gun builder keeps pricing the flea at the 24-hour average, and says so.
    const { body } = await rpc("tools/list");
    const ammoTool = body.result.tools.find((tool: { name: string }) => tool.name === "get_ammo_options");
    expect(ammoTool.description).toMatch(/flea at the 24-hour average/);
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

  it("prices only the item a name plausibly means and says which input each row came from", async () => {
    const data = fixtures.items as { data: { items: Record<string, Record<string, unknown>> } };
    const add = (id: string, name: string, shortName: string, basePrice: number) => {
      data.data.items[id] = { id, name, shortName, normalizedName: id, basePrice, width: 1, height: 1, sellToTrader: [{ trader: "trader", priceRUB: basePrice }] };
    };
    add("bitcoin-item", "Physical Bitcoin", "0.2BTC", 1_000_000);
    add("bitcoin-left", "Left half of a Physical Bitcoin", "BTC", 12_000);
    add("bitcoin-right", "Right half of a Physical Bitcoin", "BTC", 12_000);
    add("red-card", "TerraGroup Labs keycard (Red)", "Red", 1_650_000);
    add("red-flare", "26x75mm flare cartridge (Red)", "Red", 30_000);
    add("gpu-item", "Graphics card", "GPU", 200_000);

    const { data: prices } = await call("get_item_prices", {
      items: ["btc", "red", { item: "GPU", count: 2 }, "graphics crad", "Test Rifle", "test rifle", "graphics zzzz"],
    });
    expect(prices.rows.map((row: { name: string; inputs: string[]; count: number }) => [row.name, row.inputs, row.count])).toEqual([
      ["Physical Bitcoin", ["btc"], 1],
      ["Graphics card", ["GPU", "graphics crad"], 3],
      ["Test Rifle", ["Test Rifle", "test rifle"], 2],
    ]);
    expect(prices.fuzzyMatches).toEqual([
      expect.objectContaining({ input: "btc", matched: "Physical Bitcoin", matchedBy: "search", note: expect.stringContaining("Left half") }),
      expect.objectContaining({ input: "graphics crad", matched: "Graphics card", matchedBy: "fuzzy" }),
    ]);
    expect(prices.unresolved).toEqual(["red", "graphics zzzz"]);
    expect(prices.unmatched).toEqual([
      { input: "red", reason: "ambiguous", candidates: ["TerraGroup Labs keycard (Red)", "26x75mm flare cartridge (Red)"] },
      { input: "graphics zzzz", reason: "not found", candidates: ["Graphics card"] },
    ]);

    const btc = await call("get_item", { item: "btc" });
    expect(btc.data).toMatchObject({ name: "Physical Bitcoin", matchedBy: "search", note: expect.stringContaining("chose Physical Bitcoin") });
    expect(btc.data.otherMatches).toContain("Left half of a Physical Bitcoin");
    const exact = await call("get_item", { item: "Graphics card" });
    expect(exact.data.matchedBy).toBeUndefined();
    expect(exact.data.note).toBeUndefined();
    const red = await call("get_item", { item: "red" });
    expect(red.result.isError).toBe(true);
    expect(red.text).toContain("could be any of: TerraGroup Labs keycard (Red); 26x75mm flare cartridge (Red)");
    const typo = await call("get_item", { item: "graphics zzzz" });
    expect(typo.text).toContain("Did you mean: Graphics card?");

    const { data: link } = await call("create_import_link", { itemGroups: [{ name: "Loot", items: ["btc", "red", "GPU"] }] });
    expect(link.itemMatches).toEqual([
      { group: "Loot", input: "btc", item: "Physical Bitcoin", matchedBy: "search" },
      { group: "Loot", input: "red", item: null },
      { group: "Loot", input: "GPU", item: "Graphics card" },
    ]);
    expect(link.notes).toEqual([
      expect.stringMatching(/^Loot: "btc" was matched to Physical Bitcoin\. "btc" also matches/),
      'Loot: "red" could be any of TerraGroup Labs keycard (Red); 26x75mm flare cartridge (Red), so it was left out. Add the one you mean by its full name.',
    ]);
  });

  it("lists whole categories, item types, and calibers in compact pages", async () => {
    const data = fixtures.items as {
      data: { items: Record<string, Record<string, unknown>>; handbookCategories?: Record<string, unknown> };
    };
    data.data.handbookCategories = {
      meds: { name: "meds-name", normalizedName: "medication", parent: null },
      injectors: { name: "injectors-name", normalizedName: "injectors", parent: "meds" },
    };
    (fixtures.items_en as { data: Record<string, string> }).data["injectors-name"] = "Injectors";
    (fixtures.items_en as { data: Record<string, string> }).data["meds-name"] = "Medication";
    for (let index = 0; index < 30; index += 1) {
      data.data.items[`stim-${index}`] = {
        id: `stim-${index}`,
        name: `Stim ${String(index).padStart(2, "0")} injector`,
        shortName: `S${index}`,
        types: ["injectors"],
        handbookCategories: ["injectors"],
      };
    }
    data.data.items["case"] = { id: "case", name: "Injector case", shortName: "Injectors", types: ["container"] };

    const first = await call("search_items", { category: "Injectors", limit: 25, compact: true });
    expect(first.data).toMatchObject({ total: 30, nextOffset: 25 });
    expect(first.data.query).toBeUndefined();
    expect(first.data.results[0]).toEqual({ name: "Stim 00 injector", shortName: "S0" });
    const rest = await call("search_items", { category: "injector", limit: 25, offset: 25, compact: true });
    expect(rest.data.results).toHaveLength(5);
    expect(rest.data.nextOffset).toBeNull();
    // Parent categories and item types work too, and a query ranks within the category.
    expect((await call("search_items", { category: "medication", limit: 1 })).data.total).toBe(30);
    expect((await call("search_items", { category: "injectors", query: "stim 07" })).data.results[0].name).toBe("Stim 07 injector");
    expect((await call("search_items", { query: "injector", limit: 100 })).data.total).toBe(31);

    const ammo = await call("search_items", { caliber: "5.56x45", compact: true });
    expect(ammo.data.results).toEqual([{ name: "Test Ammo", shortName: null }]);

    const unknown = await call("search_items", { category: "injectros" });
    expect(unknown.result.isError).toBe(true);
    expect(unknown.text).toContain("Did you mean: Injectors?");
    expect((await call("search_items", {})).result.isError).toBe(true);

    const typo = await call("search_items", { query: "injectro" });
    expect(typo.data).toMatchObject({ fuzzy: true, total: 31 });
    const nothing = await call("search_items", { query: "stim zzzz" });
    expect(nothing.data).toMatchObject({ total: 0, results: [] });
    expect(nothing.data.didYouMean[0]).toMatch(/^Stim/);
  });

  it("says what an item is needed for: task counts, found in raid, hideout upgrades and slots", async () => {
    const tasks = fixtures.tasks as { data: { tasks: Record<string, Record<string, unknown>> } };
    tasks.data.tasks.task.objectives = [
      { description: "find-mod", type: "findItem", count: 3, foundInRaid: true, items: ["mod"] },
      { description: "hand-over", type: "giveItem", count: 3, foundInRaid: true, items: ["mod"] },
    ];
    tasks.data.tasks.any = {
      id: "any",
      name: "any-name",
      trader: "trader",
      objectives: [{ description: "hand-over", type: "giveItem", count: 5, foundInRaid: true, items: ["mod", "ammo"] }],
    };
    Object.assign((fixtures.tasks_en as { data: Record<string, string> }).data, {
      "find-mod": "Find the item in raid: Test Mod",
      "hand-over": "Hand over the item",
      "any-name": "Any Task",
    });

    const item = await call("get_item", { item: "Test Mod" });
    expect(item.data.needed).toEqual({
      total: 8,
      foundInRaid: 5,
      forTasks: 3,
      forHideout: 5,
      hideoutSlots: 5,
      summary:
        "8 needed (5 FIR): 3 for 1 task (3 FIR); 5 for 2 hideout upgrades (2 FIR); Workbench holds up to 5 installed; not counted: 1 task using it or accepting other items",
    });
    expect(item.data.usedInTasks).toEqual([
      expect.objectContaining({
        name: "Test Task",
        count: 3,
        foundInRaid: true,
        objectives: ["Find the item in raid: Test Mod (3×, found in raid)", "Hand over the item (3× Test Mod, found in raid)"],
      }),
      expect.objectContaining({
        name: "Any Task",
        count: 0,
        objectives: ["Hand over the item (5 of this or 1 other item, found in raid)"],
      }),
    ]);
    expect(item.data.hideout).toEqual([
      { station: "Workbench", level: 1, count: 2, foundInRaid: true },
      { station: "Workbench", level: 2, count: 3, foundInRaid: false },
    ]);
    expect(item.data.hideoutSlots).toEqual([{ station: "Workbench", level: 2, slots: 5 }]);

    const counts = await call("get_item", { item: "Test Mod", include: [] });
    expect(counts.data).toMatchObject({ hideoutUpgradeCount: 2, usedInTaskCount: 2 });
    expect(counts.data.needed.total).toBe(8);
    expect(counts.data.hideout).toBeUndefined();

    const prices = await call("get_item_prices", { items: ["Test Mod", "Test Ammo"] });
    expect(prices.data.rows[0].needed).toEqual({ total: 8, foundInRaid: 5, summary: item.data.needed.summary });
    expect(prices.data.rows[0].usedInTasks).toEqual(["Test Task", "Any Task"]);
    expect(prices.data.rows[1].needed).toMatchObject({ total: 0 });

    const nothing = await call("get_item", { item: "Reward" });
    expect(nothing.data.needed).toBeNull();
  });

  it("states flea eligibility and why a price is missing", async () => {
    const items = (fixtures.items as { data: { items: Record<string, Record<string, unknown>> } }).data.items;
    Object.assign(items.ammo, { types: ["ammo", "noFlea"], minLevelForFlea: 30, buyFromTrader: [], sellToTrader: [] });
    Object.assign(items.mod, { minLevelForFlea: 35, lastLowPrice: null, sellToTrader: [], buyFromTrader: [] });

    const ammo = await call("get_item", { item: "Test Ammo" });
    expect(ammo.data).toMatchObject({
      flea: { status: "banned", minPlayerLevel: null },
      bestSell: null,
      noSellReason: "No trader buys it and it is banned from the flea market.",
      cheapestBuy: null,
      noBuyReason: "No trader sells it for roubles and it is banned from the flea market. Only found in raid, bartered, or crafted.",
    });
    // The gun builder reads the same ban and words it the same way.
    const ammoOptions = await call("get_ammo_options", { build: { weapon: "Test Rifle" } });
    const ammoRow = ammoOptions.data.ammo.find((row: { name: string }) => row.name === "Test Ammo");
    expect(ammoRow).toMatchObject({ fleaPriceRUB: null, priceRUB: null });
    expect(ammoRow.priceNote).toContain("it is banned from the flea market. Only found in raid, bartered, or crafted.");

    const prices = await call("get_item_prices", { items: ["Test Mod", "Test Rifle"] });
    expect(prices.data.rows[0]).toMatchObject({
      flea: { status: "no listings", minPlayerLevel: 35 },
      noBuyReason: "No trader sells it for roubles and it has no current flea listings.",
    });
    expect(prices.data.rows[1].flea).toEqual({ status: "listed", minPlayerLevel: null });
    expect(prices.data.rows[1].noBuyReason).toBeUndefined();
  });

  it("gives weapons no per-slot value and reports their default build size", async () => {
    const items = (fixtures.items as { data: { items: Record<string, Record<string, unknown>> } }).data.items;
    Object.assign(items.weapon, { width: 1, height: 1 });
    Object.assign(items.mod, { sellToTrader: [{ trader: "trader", priceRUB: 9_000 }] });
    Object.assign(items.weapon.properties as Record<string, unknown>, { defaultWidth: 5, defaultHeight: 2 });

    const item = await call("get_item", { item: "Test Rifle" });
    expect(item.data).toMatchObject({ size: "1x1", slots: 1, defaultBuildSize: "5x2" });
    expect(item.data.bestSell.perSlotRUB).toBeNull();
    expect(item.data.sizeNote).toBe(
      "Weapon: 1x1 is the stripped weapon (default build 5x2; real size depends on attachments), so no per-slot value. Flea prices are for the default build, trader prices for the stripped weapon."
    );

    const mod = await call("get_item", { item: "Test Mod" });
    expect(mod.data.bestSell.perSlotRUB).toBe(9_000);
    expect(mod.data.sizeNote).toBeUndefined();
  });

  it("marks craft tools as kept", async () => {
    const crafts = fixtures.crafts as { data: { requiredItems: unknown[] }[] };
    crafts.data[0].requiredItems.push({ item: "mod", count: 1, attributes: { tool: true } });
    const item = await call("get_item", { item: "Test Mod", include: ["crafts"] });
    expect(item.data.crafts[0].input).toEqual(["1× Test Rifle", "1× Test Mod (tool, kept)"]);
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
    expect(options.data.options[0]).toMatchObject({ id: "mod", priceRUB: 10_000, trader: "Tester" });
    expect(options.data.options[0]).not.toHaveProperty("conflict");
    expect(options.data.options[0]).not.toHaveProperty("installed");

    const ammo = await call("get_ammo_options", { build: { weapon: "weapon" } });
    expect(ammo.data.ammo.map((entry: { id: string }) => entry.id)).toEqual(["ammo"]);

    const compared = await call("compare_builds", {
      left: { weapon: "weapon" },
      right: { shareLink: preset.data.shareLink },
    });
    expect(compared.data.slots).toEqual([{ slot: "Scope", status: "added", left: null, right: "Test Mod" }]);
    expect(compared.data.right.ammo).toBe("Test Ammo");
  });

  it("keeps optimised guns usable, explains prices, and limits trader levels", async () => {
    const items = (fixtures.items as { data: { items: Record<string, unknown> } }).data.items;
    const translations = (fixtures.items_en as { data: Record<string, string> }).data;
    const ironSight = "55818ac54bdc2d5b648b456e";
    const part = (id: string, name: string, price: number | null, properties: Record<string, unknown>, extra = {}) => {
      translations[`${id}-name`] = name;
      items[id] = {
        id,
        name: `${id}-name`,
        normalizedName: id,
        types: ["mods"],
        buyFromTrader: price === null ? [] : [{ trader: "trader", priceRUB: price, minTraderLevel: 1 }],
        properties: { propertiesType: "ItemPropertiesWeaponMod", ergonomics: 0, recoilModifier: 0, ...properties },
        ...extra,
      };
    };
    const slot = (id: string, nameId: string, name: string, allowed: string[], required = false) => {
      translations[`${id}-slot`] = name;
      return { id, name: `${id}-slot`, nameId, required, filters: { allowedItems: allowed } };
    };
    part("carbine", "Test Carbine", 20_000, {
      propertiesType: "ItemPropertiesWeapon",
      ergonomics: 40,
      recoilVertical: 100,
      recoilHorizontal: 200,
      caliber: "Caliber556x45NATO",
      allowedAmmo: ["ammo", "ssa"],
      slots: [
        slot("c-mag", "mod_magazine", "Magazine", ["mag30", "mag10"]),
        slot("c-rec", "mod_reciever", "Receiver", ["upper"], true),
      ],
    }, { types: ["gun"] });
    part("upper", "Test Upper", 5_000, {
      slots: [
        slot("u-scope", "mod_scope", "Scope", ["dot"]),
        slot("u-rear", "mod_sight_rear", "Rear sight", ["rear"]),
        slot("u-gas", "mod_gas_block", "Gas block", ["gbSight", "gbPlain"]),
      ],
    });
    part("mag30", "Test 30-round magazine", 3_000, {
      propertiesType: "ItemPropertiesMagazine",
      ergonomics: -2,
      capacity: 30,
      allowedAmmo: ["ammo", "ssa"],
    });
    part("mag10", "Test 10-round magazine", 1_000, {
      propertiesType: "ItemPropertiesMagazine",
      ergonomics: 5,
      capacity: 10,
      allowedAmmo: ["ammo", "ssa"],
    });
    part("rear", "Test rear sight", 1_000, { propertiesType: "ItemPropertiesScope" }, { categories: [ironSight] });
    part("dot", "Test red dot", 9_000, { propertiesType: "ItemPropertiesScope" });
    part("gbSight", "Test front sight gas block", 2_000, {});
    part("gbPlain", "Test plain gas block", null, { ergonomics: 3, recoilModifier: -0.02 }, {
      buyFromTrader: [{ trader: "trader", priceRUB: 1_500, minTraderLevel: 3 }],
    });
    items.ssa = {
      id: "ssa",
      name: "ssa-name",
      normalizedName: "ssa",
      types: ["ammo", "noFlea"],
      properties: { propertiesType: "ItemPropertiesAmmo", caliber: "Caliber556x45NATO", damage: 38, penetrationPower: 57 },
    };
    translations["ssa-name"] = "Test SSA AP";
    const full = {
      weapon: "Test Carbine",
      parts: [
        { slotPath: ["Magazine"], item: "mag30" },
        { slotPath: ["Receiver"], item: "upper" },
        { slotPath: ["Receiver", "Rear sight"], item: "rear" },
        { slotPath: ["Receiver", "Gas block"], item: "gbSight" },
      ],
    };

    const optimised = await call("optimize_build", { build: full, goal: "ergonomics" });
    expect(optimised.data.magazine).toEqual({ name: "Test 30-round magazine", capacity: 30, slotPath: ["c-mag"] });
    expect(optimised.data.sights.map((sight: { kind: string }) => sight.kind)).toEqual(["rear sight", "front sight"]);
    expect(optimised.data.problems).toEqual([]);
    expect(optimised.data.weapon).toMatchObject({ caliber: "5.56x45mm NATO", caliberId: "556x45NATO" });
    expect(optimised.data.ammo).toMatchObject({ loaded: null, note: expect.stringContaining("No ammo loaded") });
    const smaller = await call("optimize_build", { build: full, goal: "ergonomics", minMagazineCapacity: 0 });
    expect(smaller.data.magazine.capacity).toBe(10);

    const fromBare = await call("optimize_build", { build: { weapon: "carbine" }, goal: "cost" });
    expect(fromBare.data.magazine).not.toBeNull();

    const unusable = await call("evaluate_build", {
      build: { weapon: "carbine", parts: [{ slotPath: ["Receiver"], item: "upper" }, { slotPath: ["Gas block"], item: "gbPlain" }] },
    });
    expect(unusable.data.magazine).toBeNull();
    expect(unusable.data.problems).toEqual([
      expect.stringMatching(/^No magazine.*\["c-mag"\]/),
      expect.stringMatching(/^No usable sights: no optic and no rear sight or front sight/),
    ]);

    const overBudget = await call("optimize_build", { build: full, goal: "recoil", budgetRUB: 1_000 });
    expect(overBudget.data.withinBudget).toBe(false);
    expect(overBudget.data.minimumCostRUB).toBe(overBudget.data.stats.costRUB);
    expect(overBudget.data.notice).toMatch(/budget of 1,000 RUB can't be met.*weapon alone costs 20,000 RUB/);

    // Nested slots can be named alone; the plain gas block needs trader level 3.
    const gas = await call("get_slot_options", {
      build: full,
      slotPath: ["Gas block"],
      priceSources: { maxTraderLevel: 2 },
    });
    expect(gas.data.slot.slotPath).toEqual(["c-rec", "u-gas"]);
    const current = gas.data.options.filter((row: { installed?: boolean }) => row.installed);
    expect(current.map((row: { name: string }) => row.name)).toEqual([gas.data.current]);
    expect(gas.data.options.find((row: { id: string }) => row.id === "gbPlain")).toMatchObject({
      priceRUB: null,
      priceNote: expect.stringContaining("only Tester LL3 sells it"),
    });
    const buyable = await call("get_slot_options", {
      build: full,
      slotPath: ["Gas block"],
      buyableOnly: true,
      priceSources: { traderLevels: { tester: 2 } },
    });
    expect(buyable.data.options.map((row: { id: string }) => row.id)).toEqual(["gbSight"]);
    const levelThree = await call("get_slot_options", { build: full, slotPath: ["Gas block"], priceSources: { maxTraderLevel: 3 } });
    expect(levelThree.data.options.find((row: { id: string }) => row.id === "gbPlain").priceRUB).toBe(1_500);
    const unknownTrader = await call("get_slot_options", {
      build: full,
      slotPath: ["Gas block"],
      priceSources: { traderLevels: { Nobody: 1 } },
    });
    expect(unknownTrader.text).toContain('unknown trader "Nobody". Traders: Tester');

    const missingSlot = await call("get_slot_options", { build: full, slotPath: ["Muzzle"] });
    expect(missingSlot.text).toContain("Slots in this build: Magazine; Receiver; Receiver / Scope (empty); Receiver / Rear sight");

    const ammo = await call("get_ammo_options", { build: full });
    expect(ammo.data.ammo[0]).toMatchObject({
      name: "Test SSA AP",
      caliber: "5.56x45mm NATO",
      priceRUB: null,
      priceNote: expect.stringMatching(/no trader sells it, and it is banned from the flea market/),
    });
    const buyableAmmo = await call("get_ammo_options", { build: full, buyableOnly: true });
    expect(buyableAmmo.data.ammo.map((row: { id: string }) => row.id)).toEqual(["ammo"]);

    const loaded = await call("modify_build", { build: full, changes: [{ action: "set_ammo", ammo: "Test Ammo" }] });
    expect(loaded.data.ammo).toMatchObject({ name: "Test Ammo", fits: true });
    const weapon = await call("get_weapon", { weapon: "carbine", priceSources: { traders: false } });
    expect(weapon.data.caliber).toBe("5.56x45mm NATO");
    expect(weapon.data.baseStats).toMatchObject({
      priceRUB: null,
      priceNote: "Can't be bought: trader prices are turned off, and it has no flea price.",
    });
    const noAmmo = await call("modify_build", { build: full, changes: [{ action: "set_ammo" }] });
    expect(noAmmo.text).toContain("set_ammo needs item");
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
      {
        id: "ak-25",
        name: "AK test 25",
        shortName: "AK test 25",
        caliber: "7.62x39mm",
        caliberId: "762x39",
        hasDefaultPreset: false,
      },
    ]);
    // Calibers match by id or by their readable name.
    expect((await call("list_weapons", { caliber: "762x39" })).data.total).toBe(1);
    expect((await call("list_weapons", { caliber: "7.62x39mm" })).data.total).toBe(1);
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

  it("accepts every build, change, and point form the published schemas once spelled out as unions", async () => {
    const link = (await call("evaluate_build", { build: { weapon: "weapon", preset: "default" } })).data.shareLink;
    for (const build of [
      { shareLink: link },
      { shareLink: link, ammo: "Test Ammo", name: "Named" },
      { weapon: "weapon" },
      { weapon: "weapon", preset: "default", parts: [{ slotPath: ["slot"], item: "mod" }], ammo: "ammo", name: "x" },
    ]) {
      expect((await call("evaluate_build", { build })).result.isError, JSON.stringify(build)).toBeFalsy();
    }
    for (const build of [{}, { shareLink: link, weapon: "weapon" }, { shareLink: link, parts: [] }, { weapon: "weapon", extra: 1 }]) {
      const rejected = await call("evaluate_build", { build });
      expect(rejected.result.isError, JSON.stringify(build)).toBe(true);
      expect(rejected.text).toContain("A build is");
    }

    const modified = await call("modify_build", {
      build: { weapon: "weapon" },
      changes: [{ action: "set_ammo", ammo: "Test Ammo" }, { action: "fill_required" }, { action: "clear_ammo" }],
    });
    expect(modified.result.isError).toBeFalsy();
    expect(modified.data.applied).toHaveLength(3);
    const badChange = await call("modify_build", { build: { weapon: "weapon" }, changes: [{ action: "set_ammo" }] });
    expect(badChange.text).toContain("set_ammo needs item");
    const noSlot = await call("modify_build", { build: { weapon: "weapon" }, changes: [{ action: "install", item: "mod" }] });
    expect(noSlot.result.isError).toBe(true);

    // Coordinates win when a point has both, as the first branch of the old union did.
    const plan = await call("create_raid_plan", {
      map: "factory",
      name: "Points",
      route: [{ x: 1, z: 13, place: "nowhere at all" }, { place: "gate", x: "1" }, { x: 1, place: "gate" }],
    });
    expect(plan.result.isError).toBeFalsy();
    const decoded = await decodePlanSharePayload(new URLSearchParams(plan.data.shareLink.split("#")[1]).get("p")!);
    expect(decoded.route.map((waypoint) => waypoint.position)).toEqual([
      { x: 1, z: 13 },
      { x: 1, z: 3 },
      { x: 1, z: 3 },
    ]);
    const badPoint = await call("create_raid_plan", { map: "factory", route: [{ x: 1 }] });
    expect(badPoint.text).toContain('A point is {"x"');
  });

  it("describes maps and creates plans from named places that open in the raid planner", async () => {
    const maps = await call("list_maps");
    expect(maps.data.maps.map((map: { key: string }) => map.key)).toContain("factory");

    const details = await call("get_map_details", { map: "Factory", sections: ["extracts", "locks"] });
    expect(details.data).toMatchObject({ players: "5-6", raidDurationMinutes: 20 });
    expect(details.data.extracts[0]).toEqual({ name: "Gate", faction: "pmc", x: 1, z: 3, y: 2, level: "Ground" });
    expect(details.data.locks[0]).toMatchObject({ key: "Test Key", keyUrl: "http://localhost/item/test-key" });
    expect(details.data.layers[0].options[0]).toEqual({ id: "extracts:pmc", label: "PMC", count: 2 });

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

  it("summarises map details compactly, with bosses, extract items, and filtered, paged lists", async () => {
    const details = await call("get_map_details", { map: "factory" });
    expect(details.data.extracts[1]).toMatchObject({ name: "Car V-Ex", requiresItem: "Test Rifle" });
    expect(details.data.bosses).toEqual([
      {
        name: "Reshala",
        spawnChance: 0.5,
        locations: [
          { name: "Stronghold", chance: 0.5, x: -44, z: 44, level: "Ground" },
          { name: "Dorms", chance: 0.5 },
        ],
        escorts: 4,
      },
    ]);
    expect(details.data.spawnZones).toContainEqual({
      kind: "boss",
      zone: "Stronghold",
      points: 1,
      x: -44,
      z: 44,
      level: "Ground",
      bosses: ["Reshala 25%"],
    });
    expect(details.data.spawnZones).toContainEqual(expect.objectContaining({ kind: "pmc", zone: null, near: "Gate" }));
    expect(details.data.spawns).toBeUndefined();
    expect(details.data.locks).toBeUndefined();

    const filtered = await call("get_map_details", { map: "factory", spawnKinds: ["pmc"], lockKeys: ["test"] });
    expect(filtered.data).toMatchObject({ spawnTotal: 1, nextSpawnOffset: null, lockTotal: 1, nextLockOffset: null });
    expect(filtered.data.spawns).toEqual([{ kind: "pmc", zone: null, x: 2, z: 5, y: 2, level: "Ground" }]);
    expect(filtered.data.spawnZones).toBeUndefined();
    const none = await call("get_map_details", { map: "factory", lockKeys: ["nothing"] });
    expect(none.data).toMatchObject({ lockTotal: 0, locks: [] });

    const paged = await call("get_map_details", { map: "factory", sections: ["spawns", "locks", "lootContainers"], spawnOffset: 2 });
    expect(paged.data).toMatchObject({ spawnTotal: 3, nextSpawnOffset: null });
    expect(paged.data.spawns).toHaveLength(1);
  });

  it("reports every plan problem at once and only warns about cosmetic ones", async () => {
    const rejected = await call("create_raid_plan", {
      map: "factory",
      route: [{ place: "Gaet" }, { place: "nowhere at all" }, { x: 99_999, z: -99_999 }],
      drawings: [{ kind: "pen", color: "purple", points: [{ x: 0, z: 0 }, { place: "Car" }] }],
      notes: [{ at: { x: 1, z: 99_999 }, title: "Far" }],
    });
    expect(rejected.result.isError).toBe(true);
    expect(rejected.text).toContain("Fix these 3 problems");
    expect(rejected.text).toContain('route[1]: No place is named "nowhere at all".');
    expect(rejected.text).toContain("route[2]: x 99999, z -99999 is outside Factory");
    expect(rejected.text).toContain("notes[0].at: x 1, z 99999 is outside Factory");

    const created = await call("create_raid_plan", {
      map: "factory",
      route: [{ place: "Gaet" }, { place: "car" }],
      drawings: [{ kind: "arrow", color: "purple", points: [{ x: 0, z: 0 }, { place: "stronghold" }] }],
      layers: ["extracts:pmc", "spawns:nowhere"],
    });
    expect(created.data.name).toBe("Factory: Gate to Car V-Ex");
    expect(created.data.resolvedPlaces).toEqual([
      { input: "Gaet", resolved: "Gate (pmc extract)", match: "typo", approximate: true, level: "Ground" },
      { input: "car", resolved: "Car V-Ex (pmc extract)", match: "partial", approximate: true, level: "Ground" },
      {
        input: "stronghold",
        resolved: "Stronghold (scav spawn)",
        match: "exact",
        level: "Ground",
        alsoNamed: ["Stronghold (boss spawn)"],
      },
    ]);
    expect(created.data.warnings).toEqual([
      '"Gaet" was placed at Gate (pmc extract), a typo match. Describe it by that name, or give coordinates.',
      '"car" was placed at Car V-Ex (pmc extract), a partial match. Describe it by that name, or give coordinates.',
      'Colour "purple" is not available, so red was used. Colours: tan, green, orange, red, blue, white.',
      "Left out layer ids this map does not have: spawns:nowhere.",
    ]);
    const plan = await decodePlanSharePayload(new URLSearchParams(created.data.shareLink.split("#")[1]).get("p")!);
    expect(plan.drawings[0].color).toBe("#d46b6b");
    expect(plan.name).toBe("Factory: Gate to Car V-Ex");

    const unnamed = await call("create_raid_plan", { map: "factory", route: [{ x: 1, z: 1 }] });
    expect(unnamed.data.name).toBe("Factory raid plan");
    const badMap = await call("create_raid_plan", { map: "the moon" });
    expect(badMap.text).toContain('No map matches "the moon"');
  });

  it("warns when a plan link has points outside the map", async () => {
    const { encodePlanSharePayload } = await import("@/app/lib/raid-planner/share");
    const payload = await encodePlanSharePayload({
      id: "plan",
      name: "Far away",
      mapKey: "factory",
      createdAt: 1,
      updatedAt: 1,
      enabledLayers: [],
      route: [{ id: "a", position: { x: 1, z: 3 } }, { id: "b", position: { x: 5000, z: 5000 } }],
      drawings: [],
      notes: [],
    });
    const read = await call("read_raid_plan", { link: payload });
    expect(read.data.warnings).toEqual(["1 point is outside the map."]);
    expect(read.data.route[0].near).toBe("Gate (pmc extract, 0 m)");
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
