// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildItemIndex } from "../scripts/item-index.mjs";
import { rebuildItemIndexes } from "../scripts/build-tarkov-snapshot.mjs";
import { POST } from "@/app/api/mcp/route";
import { expandItemIndex } from "@/app/lib/api/item-index";
import { resetRequestBudgets } from "@/app/lib/api/rate-limit";
import {
  canReuseSnapshot,
  clearTarkovResourceCache,
  getItemCatalog,
  getItemDetail,
  getItemFacets,
  peekItemCopies,
  runTarkovRead,
  settleTarkovRefreshes,
  type DataSnapshot,
  type ItemFacet,
  type ItemFacets,
} from "@/app/lib/api/tarkov-server";
import { setTarkovSnapshotDirForTests } from "@/app/lib/api/tarkov-snapshot";
import type { CatalogEntry } from "@/app/lib/cache/types";
import { searchCatalog } from "@/app/lib/search/filter-catalog";
import { indexCatalog, matchItemReference } from "@/app/lib/search/item-reference";
import { createTarkovFixtures } from "./fixtures/tarkov";

// Item search, name matching and category filters read the compact item index instead of the items
// file. The index must give exactly what the adapter projected from the items file before it.

// The adapter's projections from the items file before the index, kept as the reference.
type Dictionary<T> = Record<string, T>;
type RawCategory = { name?: string | null; normalizedName?: string | null; parent?: string | null };

function translate(value: string | null | undefined, translations: Dictionary<string>) {
  if (!value) return "";
  return translations[value] ?? value;
}

function referenceImage(id: string, link: unknown): string | null {
  if (typeof link !== "string" || link.length === 0 || link.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const safe = url.toString();
  if (new URL(safe).hostname !== "assets.tarkov.dev") return null;
  const path = new URL(safe).pathname.slice(1);
  return path === `${id}-grid-image.webp` ? "" : path;
}

function referenceCatalog(data: any, translations: Dictionary<string>): CatalogEntry[] {
  return (Object.values(data.items ?? {}) as any[]).flatMap((item): CatalogEntry[] => {
    if (!item.id) return [];
    const name = translate(item.name, translations);
    if (!name) return [];
    return [[
      item.id,
      name,
      item.shortName === null || item.shortName === undefined ? null : translate(item.shortName, translations),
      referenceImage(item.id, item.gridImageLink),
      item.normalizedName ?? null,
    ]];
  });
}

function referenceFacets(data: any, translations: Dictionary<string>): ItemFacets {
  const trees: Dictionary<RawCategory>[] = [data.handbookCategories ?? {}, data.itemCategories ?? {}];
  const labels = (tree: Dictionary<RawCategory>, id: string) => {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (let current: string | null | undefined = id; current && !seen.has(current); current = tree[current]?.parent) {
      seen.add(current);
      const category = tree[current];
      if (!category) break;
      const name = translate(category.name, translations).toLocaleLowerCase();
      if (name) keys.push(name);
      if (category.normalizedName) keys.push(category.normalizedName);
    }
    return keys;
  };
  const byId = new Map<string, ItemFacet>();
  for (const item of Object.values(data.items ?? {}) as any[]) {
    if (!item.id) continue;
    const categories = new Set([
      ...((item.handbookCategories ?? []) as string[]).flatMap((id) => labels(trees[0], id)),
      ...((item.categories ?? []) as string[]).flatMap((id) => labels(trees[1], id)),
    ]);
    byId.set(item.id, { types: item.types ?? [], categories: [...categories], caliber: item.properties?.caliber ?? null });
  }
  const names = (tree: Dictionary<RawCategory>) =>
    Array.from(new Set(Object.values(tree).map((category) => translate(category.name, translations)))).filter(Boolean);
  return { byId, categoryNames: names(trees[0]), itemCategoryNames: names(trees[1]) };
}

/** The index as a deployment reads it: through JSON, then expanded. */
function indexed(data: unknown, translations: Dictionary<string>) {
  return expandItemIndex(JSON.parse(JSON.stringify(buildItemIndex(data, translations))));
}

/** Items with the awkward cases: missing and looping parents, unknown categories, odd images, nameless items. */
function edgeCaseItems() {
  const translations: Dictionary<string> = {
    "rifle-name": "Colt M4A1 5.56x45 assault rifle",
    "rifle-short": "M4A1",
    "ammo-name": "5.56x45mm M855A1",
    "ammo-short": "M855A1",
    "stim-name": "eTG-change regenerative stimulant injector",
    "stim-short": "eTG-c",
    "flare-name": "Red Flare",
    "card-name": "TerraGroup Labs keycard (Red)",
    "card-short": "Red",
    hb_weapons: "Weapons",
    hb_rifles: "Assault rifles",
    hb_ammo: "Ammo",
    hb_rounds: "Rounds",
    hb_meds: "Medication",
    hb_stims: "Injectors",
    cat_stim: "Stimulant",
    cat_loop_a: "Loop A",
    cat_loop_b: "Loop B",
  };
  const data = {
    handbookCategories: {
      weapons: { name: "hb_weapons", normalizedName: "weapons", parent: null },
      rifles: { name: "hb_rifles", normalizedName: "assault-rifles", parent: "weapons" },
      ammo: { name: "hb_ammo", normalizedName: "ammo", parent: null },
      rounds: { name: "hb_rounds", normalizedName: "rounds", parent: "ammo" },
      meds: { name: "hb_meds", normalizedName: "medication", parent: "gone" },
      stims: { name: "hb_stims", normalizedName: "injectors", parent: "meds" },
      untranslated: { name: "Barter items", normalizedName: null },
      duplicate: { name: "hb_rounds", normalizedName: "rounds-2", parent: "ammo" },
    },
    itemCategories: {
      stim: { name: "cat_stim", normalizedName: "stimulant", parent: "loop-a" },
      "loop-a": { name: "cat_loop_a", normalizedName: "loop-a", parent: "loop-b" },
      "loop-b": { name: "cat_loop_b", normalizedName: "", parent: "loop-a" },
      nameless: { normalizedName: "nameless" },
    },
    items: {
      rifle: {
        id: "rifle",
        name: "rifle-name",
        shortName: "rifle-short",
        normalizedName: "colt-m4a1-556x45-assault-rifle",
        gridImageLink: "https://assets.tarkov.dev/rifle-grid-image.webp",
        types: ["gun", "wearable"],
        handbookCategories: ["rifles", "missing"],
        categories: [],
        properties: { caliber: "Caliber556x45NATO" },
      },
      ammo: {
        id: "ammo",
        name: "ammo-name",
        shortName: "ammo-short",
        normalizedName: "556x45mm-m855a1",
        gridImageLink: "https://assets.tarkov.dev/other-image.webp",
        types: ["ammo"],
        handbookCategories: ["rounds", "duplicate"],
        properties: { caliber: "Caliber556x45NATO" },
      },
      stim: {
        id: "stim",
        name: "stim-name",
        shortName: "stim-short",
        normalizedName: "etg-change-regenerative-stimulant-injector",
        gridImageLink: "http://assets.tarkov.dev/stim-grid-image.webp",
        types: ["injectors"],
        handbookCategories: ["stims"],
        categories: ["stim", "nameless"],
      },
      flare: {
        id: "flare",
        name: "flare-name",
        shortName: "",
        normalizedName: "red-flare",
        gridImageLink: "https://example.com/flare-grid-image.webp",
        types: [],
      },
      card: {
        id: "card",
        name: "card-name",
        shortName: "card-short",
        normalizedName: "terragroup-labs-keycard-red",
        gridImageLink: "https://user:pw@assets.tarkov.dev/card-grid-image.webp",
        handbookCategories: ["untranslated"],
      },
      untranslated: { id: "untranslated", name: "Raw name", shortName: null, gridImageLink: "not a url" },
      nameless: { id: "nameless", name: "", types: ["quest"], handbookCategories: ["weapons"] },
      noId: { name: "flare-name" },
    },
  };
  return { data, translations };
}

describe("the item index", () => {
  it("gives the catalog and facets the items file gave, through the awkward cases", () => {
    const { data, translations } = edgeCaseItems();
    const { catalog, facets } = indexed(data, translations);
    expect(catalog).toEqual(referenceCatalog(data, translations));
    expect(facets).toEqual(referenceFacets(data, translations));
    expect([...facets.byId.keys()]).toEqual([...referenceFacets(data, translations).byId.keys()]);
  });

  it("gives the same catalog and facets for the test fixtures", () => {
    const fixtures = createTarkovFixtures() as any;
    const { catalog, facets } = indexed(fixtures.items.data, fixtures.items_en.data);
    expect(catalog).toEqual(referenceCatalog(fixtures.items.data, fixtures.items_en.data));
    expect(facets).toEqual(referenceFacets(fixtures.items.data, fixtures.items_en.data));
  });

  it("resolves and searches names exactly as the items file did", () => {
    const { data, translations } = edgeCaseItems();
    const before = indexCatalog(referenceCatalog(data, translations));
    const after = indexCatalog(indexed(data, translations).catalog);
    for (const query of ["M4A1", "colt m4a1", "red", "eTG-c", "stimulant injecter", "rifle", "Raw name", "card", "zzzz"]) {
      expect(matchItemReference(after, query), query).toEqual(matchItemReference(before, query));
      expect(searchCatalog(after.items, query, { fuzzy: true }), query).toEqual(searchCatalog(before.items, query, { fuzzy: true }));
    }
  });
});

// The stand-in for tarkov.dev that scripts/mcp-load.mjs uses: <mode>-<resource>.json per dataset.
const REAL_DATA = process.env.ITEM_INDEX_DATA;
const MODES = ["regular", "pve"] as const;
const realFile = (mode: string, resource: string) => join(REAL_DATA ?? "", `${mode}-${resource}.json`);
const hasRealData = Boolean(REAL_DATA) && MODES.every((mode) => existsSync(realFile(mode, "items")));
const readReal = (mode: string, resource: string) => JSON.parse(readFileSync(realFile(mode, resource), "utf8"));

describe.skipIf(!hasRealData)("the item index of tarkov.dev's items (ITEM_INDEX_DATA)", () => {
  it.each(MODES)("stays well under 300 KB brotli and matches the items file (%s)", (mode) => {
    const data = readReal(mode, "items").data;
    const translations = readReal(mode, "items_en").data;
    const raw = Buffer.from(JSON.stringify(buildItemIndex(data, translations)));
    const compressed = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
    expect(compressed.length).toBeLessThan(300_000);
    const { catalog, facets } = indexed(data, translations);
    const reference = referenceCatalog(data, translations);
    expect(catalog).toEqual(reference);
    expect(facets).toEqual(referenceFacets(data, translations));
    const before = indexCatalog(reference);
    const after = indexCatalog(catalog);
    const [id, , shortName, , slug] = reference[0];
    for (const query of [
      "ledx",
      "salewa",
      "graphics crad",
      "red",
      "injector",
      "folder",
      "m4a1",
      "5.56x45 m855a1",
      "gpu",
      "btc",
      shortName ?? "",
      id,
      slug ?? "",
      `https://www.eft-toolset.com/item/${slug}`,
      "zzzz-no-such-item",
    ]) {
      expect(matchItemReference(after, query), query).toEqual(matchItemReference(before, query));
    }
  });
});

describe("the adapter's item catalog and facets", () => {
  let fixtures: Record<string, any>;
  let snapshotDir: string | null;
  let itemsRequests: number;
  let upstreamDown: boolean;

  beforeEach(() => {
    clearTarkovResourceCache();
    resetRequestBudgets();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fixtures = createTarkovFixtures();
    snapshotDir = null;
    itemsRequests = 0;
    upstreamDown = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const resource = new URL(String(input)).pathname.split("/").pop()!;
      if (resource === "items") itemsRequests += 1;
      if (upstreamDown) return new Response("bad gateway", { status: 502 });
      return new Response(JSON.stringify(fixtures[resource]), { status: 200, headers: { ETag: `"${resource}-2"` } });
    });
  });

  afterEach(async () => {
    upstreamDown = false;
    await settleTarkovRefreshes();
    setTarkovSnapshotDirForTests(null);
    if (snapshotDir) await rm(snapshotDir, { recursive: true, force: true });
  });

  /** A deployment snapshot of the fixtures fetched ageMs ago, with ETags "<resource>-1", and its item indexes. */
  async function snapshot(ageMs: number, { index = true } = {}) {
    const dir = await mkdtemp(join(tmpdir(), "item-index-"));
    await mkdir(join(dir, "regular"));
    const resources: Record<string, unknown> = {};
    for (const resource of ["items", "items_en"]) {
      await writeFile(join(dir, "regular", `${resource}.json.br`), brotliCompressSync(JSON.stringify(fixtures[resource])));
      resources[`regular/${resource}`] = { fetchedAt: Date.now() - ageMs, etag: `"${resource}-1"` };
    }
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ version: 1, builtAt: Date.now() - ageMs, resources }));
    if (index) await rebuildItemIndexes(dir, { info: () => undefined, warn: () => undefined });
    setTarkovSnapshotDirForTests(dir);
    snapshotDir = dir;
    return dir;
  }

  async function read<T>(work: () => Promise<T>) {
    let ageMs: number | null = null;
    let stale = false;
    let snapshot: DataSnapshot = [];
    const value = await runTarkovRead(work, {
      maxStaleMs: Number.POSITIVE_INFINITY,
      onDataAge: (age) => (ageMs = age),
      onStale: () => (stale = true),
      onSnapshot: (used) => (snapshot = used),
    });
    return { value, ageMs: ageMs as number | null, stale, snapshot };
  }

  async function callTool(name: string, args: Record<string, unknown>) {
    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      })
    );
    return (await response.json()).result as { isError?: boolean; content: { text?: string }[]; structuredContent?: any };
  }

  it("serve the bundled index without loading the items file, never aged or stale by the deployment", async () => {
    await snapshot(26 * 60 * 60_000);
    upstreamDown = true;
    const catalog = await read(() => getItemCatalog("regular"));
    const facets = await read(() => getItemFacets("regular"));
    expect(catalog.value).toEqual(referenceCatalog(fixtures.items.data, fixtures.items_en.data));
    expect(facets.value).toEqual(referenceFacets(fixtures.items.data, fixtures.items_en.data));
    expect(itemsRequests).toBe(0);
    expect(peekItemCopies("regular")).toBeNull();
    expect(catalog.stale).toBe(false);
    // Names change only with game patches, so the deployment's age doesn't make the catalog old.
    expect(catalog.ageMs).toBeNull();
    expect(canReuseSnapshot(catalog.snapshot)).toBe(true);

    const result = await callTool("search_items", { query: "rifle" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.results.map((item: { name: string }) => item.name)).toEqual(["Test Rifle"]);
    expect(result.structuredContent.dataNotice).toBeUndefined();
    expect(result.structuredContent.dataAsOf).toBeUndefined();
    expect(itemsRequests).toBe(0);
  });

  it("answer search_items the same from the bundled index as from the items file", async () => {
    const queries: Record<string, unknown>[] = [
      { query: "rifle" },
      { query: "test" },
      { query: "Rifle" },
      { query: "tset mod" },
      { query: "zzzz" },
      { caliber: "5.56x45" },
      { query: "test", caliber: "556x45" },
      { category: "nonexistent" },
    ];
    const answers = async () => {
      const results = [];
      for (const args of queries) {
        const { structuredContent, content } = await callTool("search_items", args);
        if (!structuredContent) results.push(content[0].text);
        else {
          // The items-file path dates its answer and its prices; the index, like any static copy, doesn't.
          const { dataAsOf: _dataAsOf, priceSource: _priceSource, ...rest } = structuredContent;
          results.push(rest);
        }
      }
      return results;
    };
    await snapshot(60_000, { index: false });
    const fromItems = await answers();
    expect(itemsRequests).toBe(0);
    expect(peekItemCopies("regular")).not.toBeNull();
    await rm(snapshotDir!, { recursive: true, force: true });
    clearTarkovResourceCache();
    await snapshot(60_000);
    expect(await answers()).toEqual(fromItems);
    expect(peekItemCopies("regular")).toBeNull();
  });

  it("derive the index from a newer items copy in hand, and keep the bundled one for the same files", async () => {
    await snapshot(60_000);
    const bundled = await read(() => getItemCatalog("regular"));

    // The deployment's own copies, seeded for an item page: the same files, so the bundled index.
    await read(() => getItemDetail("regular", { name: "Test Rifle" }));
    expect(peekItemCopies("regular")?.items.etag).toBe('"items-1"');
    const same = await read(() => getItemCatalog("regular"));
    expect(same.value).toBe(bundled.value);
    expect(canReuseSnapshot(bundled.snapshot)).toBe(true);

    // A patch renames an item, and a read that needs the items file brings the new copy.
    fixtures.items_en.data["weapon-name"] = "Renamed Rifle";
    vi.useFakeTimers({ now: Date.now() + 3 * 60 * 60_000, toFake: ["Date"] });
    await read(() => getItemDetail("regular", { name: "Test Mod" }));
    await settleTarkovRefreshes();
    expect(peekItemCopies("regular")?.translations.etag).toBe('"items_en-2"');
    const derived = await read(() => getItemCatalog("regular"));
    expect(derived.value.find(([id]) => id === "weapon")?.[1]).toBe("Renamed Rifle");
    expect(derived.value).toEqual(referenceCatalog(fixtures.items.data, fixtures.items_en.data));
    expect(canReuseSnapshot(bundled.snapshot)).toBe(false);
    expect(canReuseSnapshot(derived.snapshot)).toBe(true);
    // Built once per pair of copies.
    expect((await read(() => getItemCatalog("regular"))).value).toBe(derived.value);
    expect((await read(() => getItemFacets("regular"))).value.byId.get("weapon")).toEqual({
      types: ["gun"],
      categories: [],
      caliber: null,
    });
    vi.useRealTimers();
  });

  it("load the items file as before when the deployment has no index", async () => {
    const catalog = await read(() => getItemCatalog("regular"));
    expect(itemsRequests).toBe(1);
    expect(catalog.value).toEqual(referenceCatalog(fixtures.items.data, fixtures.items_en.data));
    expect(catalog.snapshot.map(([key]) => key).sort()).toEqual(["regular/items", "regular/items_en"]);
    expect((await read(() => getItemFacets("regular"))).value).toEqual(
      referenceFacets(fixtures.items.data, fixtures.items_en.data)
    );
  });
});
