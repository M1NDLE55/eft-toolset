// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import { clearTarkovResourceCache, executeTarkovOperation } from "@/app/lib/api/tarkov-server";
import { isKeyInfo, itemDetailQuery } from "@/app/lib/cache/fetcher";
import type { ComposedItem } from "@/app/lib/cache/types";
import { setWikiSnapshotDirectory } from "@/app/lib/wiki/snapshot";
import { createTarkovFixtures } from "./fixtures/tarkov";

const TANKER = "5d80c62a86f7744036212b3f";
const KEYCARD = "5c94bbff86f7747ee735c08f";
const OPENS = "Unlocks the driver-side door of the orange tanker truck at the construction site on Customs.";

type Fixtures = Record<string, { data: Record<string, Record<string, unknown>> }>;
let fixtures: Fixtures;

function writeWiki() {
  const directory = mkdtempSync(join(tmpdir(), "key-wiki-"));
  mkdirSync(join(directory, "items"));
  writeFileSync(join(directory, "item-ids.json"), JSON.stringify({ [TANKER]: "items/tanker.json", [KEYCARD]: "items/keycard.json" }));
  const page = (title: string, usage: string) => ({
    title,
    url: `https://escapefromtarkov.fandom.com/wiki/${title.replace(/ /g, "_")}`,
    lastEdited: "2026-09-29T00:00:00Z",
    infobox: { usage },
    sections: [],
  });
  writeFileSync(join(directory, "items/tanker.json"), JSON.stringify(page("Tanker key", `  ${OPENS} `)));
  writeFileSync(join(directory, "items/keycard.json"), JSON.stringify(page("Access keycard", "Opens:,")));
  return directory;
}

const detail = async (name: string) =>
  (await executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, { gameMode: "regular", name })) as ComposedItem;

beforeEach(() => {
  fixtures = createTarkovFixtures() as Fixtures;
  const items = fixtures.items.data;
  items.items.tanker = { id: TANKER, name: "tanker-name", normalizedName: "tanker-key", categories: ["mech", "keys"] };
  items.items.keycard = { id: KEYCARD, name: "keycard-name", normalizedName: "access-keycard", categories: ["card", "keys"] };
  items.itemCategories = {
    keys: { name: "keys-name", normalizedName: "key" },
    mech: { name: "mech-name", normalizedName: "mechanical-key", parent: "keys" },
    card: { name: "card-name", normalizedName: "keycard", parent: "keys" },
  };
  Object.assign(fixtures.items_en.data, {
    "tanker-name": "Tanker key",
    "keycard-name": "Access keycard",
    "keys-name": "Key",
    "mech-name": "Mechanical Key",
    "card-name": "Keycard",
  });
  const maps = fixtures.maps.data.maps as Record<string, { locks: unknown[] }>;
  const at = { x: 1, y: 2, z: 3 };
  maps.map.locks.push({ key: TANKER, position: at }, { key: TANKER, position: at }, { key: TANKER });
  maps.customs = { normalizedName: "customs", locks: [{ key: TANKER, position: at }] } as never;
  maps.moon = { normalizedName: "not-a-keys-page", locks: [{ key: TANKER, position: at }] } as never;

  clearTarkovResourceCache();
  setWikiSnapshotDirectory(writeWiki());
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const fixture = fixtures[new URL(String(input)).pathname.split("/").pop()!];
    return fixture ? Response.json(fixture) : new Response("missing fixture", { status: 404 });
  });
});

afterAll(() => setWikiSnapshotDirectory(join(process.cwd(), "data", "wiki")));

describe("item.detail for keys", () => {
  it("lists the keys-page maps whose locks a key opens, in map order, and what it opens", async () => {
    expect((await detail("Tanker key")).key).toEqual({
      maps: [
        { key: "customs", name: "Customs", locks: 1 },
        { key: "factory", name: "Factory", locks: 2 },
      ],
      opens: OPENS,
    });
  });

  it("gives a key with locks but no wiki page no description", async () => {
    expect((await detail("Test Key")).key).toEqual({ maps: [{ key: "factory", name: "Factory", locks: 1 }], opens: null });
  });

  it("leaves out a key with no locks and an unusable infobox, and items that aren't keys", async () => {
    expect((await detail("Access keycard")).key).toBeUndefined();
    expect((await detail("Test Rifle")).key).toBeUndefined();
  });

  it("still returns the detail, without a description, when the wiki can't be read", async () => {
    setWikiSnapshotDirectory(join(tmpdir(), "missing-wiki-snapshot"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const item = await detail("Tanker key");
    expect(item.name).toBe("Tanker key");
    expect(item.key).toEqual({ maps: expect.any(Array), opens: null });
    expect(item.key!.maps).toHaveLength(2);
  });
});

describe("cached key info validation", () => {
  it("keeps a cached key's detail and drops one with a malformed key", async () => {
    const item = await detail("Tanker key");
    expect(itemDetailQuery.validate!(item)).toBe(true);
    expect(itemDetailQuery.validate!({ ...item, key: { maps: "customs", opens: null } })).toBe(false);
  });

  it("accepts well-formed key info", () => {
    expect(isKeyInfo({ maps: [{ key: "customs", name: "Customs", locks: 1 }], opens: OPENS })).toBe(true);
    expect(isKeyInfo({ maps: [], opens: null })).toBe(true);
  });

  it("rejects malformed key info", () => {
    expect(isKeyInfo(null)).toBe(false);
    expect(isKeyInfo({ maps: [], opens: "x".repeat(1_001) })).toBe(false);
    expect(isKeyInfo({ maps: [], opens: 3 })).toBe(false);
    expect(isKeyInfo({ maps: [{ key: "../customs", name: "Customs", locks: 1 }], opens: null })).toBe(false);
    expect(isKeyInfo({ maps: [{ key: "customs", name: "Customs", locks: Number.NaN }], opens: null })).toBe(false);
    expect(isKeyInfo({ maps: [{ key: "customs", name: "x".repeat(201), locks: 1 }], opens: null })).toBe(false);
    expect(isKeyInfo({ maps: Array.from({ length: 51 }, () => ({ key: "customs", name: "Customs", locks: 1 })), opens: null })).toBe(false);
  });
});
