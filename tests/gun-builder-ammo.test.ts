import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AmmoItemData, BuildItemData, BuildNode, ModSlotDef } from "@/app/lib/types/gunBuilder";
import { ammoFits, ammoOptions, findMagazine } from "@/app/lib/builds/ammo";
import { computeStats } from "@/app/lib/builds/stats";
import { optimizeBuild } from "@/app/lib/builds/optimizer";
import { BUILD_STORE, createBuild, duplicateBuild, setBuildAmmo } from "@/app/lib/builds/store";
import { decodeBuildSharePayload, encodeBuildSharePayload } from "@/app/lib/builds/share";
import { encodeSharePayload } from "@/app/lib/share-codec";
import { readStore } from "@/app/lib/storage/versioned-store";

const BOTH = { traders: true, flea: true };

function slot(id: string, allowed: string[], extra: Partial<ModSlotDef> = {}): ModSlotDef {
  return { id, name: id, nameId: id, required: false, allowedItemIds: allowed, ...extra };
}

function item(id: string, extra: Partial<BuildItemData> = {}): BuildItemData {
  return {
    id,
    name: id,
    shortName: id,
    gridImageLink: null,
    weight: 0.1,
    traderPriceRUB: 1000,
    fleaPriceRUB: null,
    ergonomics: 0,
    recoilModifier: 0,
    recoilVertical: null,
    recoilHorizontal: null,
    isWeapon: false,
    conflictingItemIds: [],
    conflictingSlotIds: [],
    slots: [],
    ...extra,
  };
}

function ammo(id: string, extra: Partial<AmmoItemData> = {}): AmmoItemData {
  return {
    id,
    normalizedName: id,
    name: id,
    shortName: id,
    gridImageLink: null,
    caliber: "Caliber556x45NATO",
    damage: 50,
    penetrationPower: 30,
    armorDamage: 40,
    fragmentationChance: 0.2,
    projectileCount: 1,
    initialSpeed: 900,
    recoilModifier: 0,
    accuracyModifier: 0,
    traderPriceRUB: 300,
    fleaPriceRUB: null,
    traderName: "Prapor",
    traderLevel: 2,
    ...extra,
  };
}

const data = new Map<string, BuildItemData>([
  ["gun", item("gun", {
    isWeapon: true,
    recoilVertical: 100,
    recoilHorizontal: 200,
    allowedAmmoIds: ["m855", "m995", "subsonic"],
    slots: [slot("mag", ["magStd", "magDrum"], { required: true }), slot("muzzle", ["brake"])],
  })],
  ["magStd", item("magStd", { allowedAmmoIds: ["m855", "m995"], ergonomics: -1 })],
  ["magDrum", item("magDrum", { allowedAmmoIds: ["m855"], ergonomics: 2 })],
  ["brake", item("brake", { recoilModifier: -0.1 })],
]);

describe("ammo options", () => {
  it("uses the magazine's ammo, limited to what the chamber accepts", () => {
    const root: BuildNode = { itemId: "gun", slots: { mag: { itemId: "magStd", slots: {} } } };
    expect(findMagazine(root, data)).toBe("magStd");
    expect(ammoOptions(root, data)).toEqual({ ids: ["m855", "m995"], source: "magazine", magazineId: "magStd" });
    expect(ammoFits("m995", ammoOptions(root, data))).toBe(true);
    expect(ammoFits("subsonic", ammoOptions(root, data))).toBe(false);
  });

  it("falls back to the weapon's ammo without a magazine", () => {
    const options = ammoOptions({ itemId: "gun", slots: {} }, data);
    expect(options).toEqual({ ids: ["m855", "m995", "subsonic"], source: "weapon", magazineId: null });
    expect(ammoFits(null, options)).toBe(false);
  });
});

describe("ammo in stats and the optimiser", () => {
  it("adds ammo recoil to the build's recoil modifier", () => {
    const root: BuildNode = { itemId: "gun", slots: { muzzle: { itemId: "brake", slots: {} } } };
    expect(computeStats(root, data, BOTH).recoilVertical).toBeCloseTo(90);
    expect(computeStats(root, data, BOTH, ammo("hot", { recoilModifier: 0.05 })).recoilVertical).toBeCloseTo(95);
    expect(computeStats(root, data, BOTH, ammo("bad", { recoilModifier: Number.NaN })).recoilVertical).toBeCloseTo(90);
  });

  it("prefers a magazine that can load the chosen ammo", async () => {
    const root: BuildNode = { itemId: "gun", slots: {} };
    const free = await optimizeBuild(root, data, { goal: "ergonomics", priceSources: BOTH }, { pause: async () => undefined });
    expect(free.root.slots.mag.itemId).toBe("magDrum");
    const withAmmo = await optimizeBuild(
      root,
      data,
      { goal: "ergonomics", priceSources: BOTH, ammoId: "m995" },
      { pause: async () => undefined }
    );
    expect(withAmmo.root.slots.mag.itemId).toBe("magStd");
    const unmatched = await optimizeBuild(
      root,
      data,
      { goal: "ergonomics", priceSources: BOTH, ammoId: "nothing-loads-this" },
      { pause: async () => undefined }
    );
    expect(unmatched.root.slots.mag).toBeDefined();
  });
});

describe("ammo storage and sharing", () => {
  beforeEach(() => localStorage.clear());

  it("stores, clears and copies the chosen ammo with strict ids", () => {
    const build = createBuild("Ammo", "gun", undefined, "m855");
    expect(build.ammoId).toBe("m855");
    expect(createBuild("Bad", "gun", undefined, "bad id!").ammoId).toBeUndefined();
    expect(duplicateBuild(build.id).ammoId).toBe("m855");
    expect(setBuildAmmo(build.id, null).ammoId).toBeUndefined();
    expect("ammoId" in readStore(BUILD_STORE)[0]).toBe(false);
    expect(() => setBuildAmmo(build.id, "<script>")).toThrow();
  });

  it("migrates version 1 storage and keeps builds without ammo valid", () => {
    const legacy = [{ id: "a", name: "Old", weaponId: "gun", root: { itemId: "gun", slots: {} }, createdAt: 1, updatedAt: 1 }];
    localStorage.setItem(BUILD_STORE.key, JSON.stringify({ version: 1, data: legacy }));
    expect(readStore(BUILD_STORE)).toEqual(legacy);
    expect(JSON.parse(localStorage.getItem(BUILD_STORE.key)!).version).toBe(2);
    expect(BUILD_STORE.validate(legacy)).toBe(true);
    expect(BUILD_STORE.validate([{ ...legacy[0], ammoId: "x y" }])).toBe(false);
    expect(BUILD_STORE.validate([{ ...legacy[0], ammoId: 5 }])).toBe(false);
  });

  it("round-trips ammo in share links and still reads links without it", async () => {
    const root: BuildNode = { itemId: "gun", slots: {} };
    const base = { id: "id", name: "Share", weaponId: "gun", root, createdAt: 0, updatedAt: 0 };
    const withAmmo = await encodeBuildSharePayload({ ...base, ammoId: "m855" });
    await expect(decodeBuildSharePayload(withAmmo)).resolves.toEqual({ name: "Share", weaponId: "gun", root, ammoId: "m855" });
    const legacy = await encodeSharePayload({ v: 1, n: "Old", w: "gun", r: ["gun"] });
    await expect(decodeBuildSharePayload(legacy)).resolves.toMatchObject({ ammoId: null });
  });

  it("rejects share recipes with bad ammo or unknown fields", async () => {
    for (const recipe of [
      { v: 1, w: "gun", r: ["gun"], a: "../x" },
      { v: 1, w: "gun", r: ["gun"], a: 7 },
      { v: 1, w: "gun", r: ["gun"], extra: true },
      { v: 1, w: "gun", r: ["gun"], ["__proto__"]: { a: 1 } },
    ]) {
      const payload = await encodeSharePayload(recipe);
      await expect(decodeBuildSharePayload(payload)).rejects.toThrow();
    }
    expect(() =>
      encodeBuildSharePayload({ id: "i", name: "n", weaponId: "gun", root: { itemId: "gun", slots: {} }, ammoId: "bad id", createdAt: 0, updatedAt: 0 })
    ).toThrow(/safe sharing limits/);
  });
});

describe("ammo data loading", () => {
  it("validates ammo responses and caches by id", async () => {
    vi.resetModules();
    const calls: string[][] = [];
    const catalog = new Map([["m855", ammo("m855")]]);
    let respond: (ids: string[]) => unknown = (ids) => ids.flatMap((id) => (catalog.has(id) ? [catalog.get(id)] : []));
    vi.doMock("@/app/lib/api/transport", () => ({
      apiFetch: async (operation: string, variables: { ids: string[] }) => {
        expect(operation).toBe("gun.ammo-items");
        calls.push(variables.ids);
        return respond(variables.ids);
      },
    }));
    vi.doMock("@/app/lib/cache/store", () => ({
      cacheGetMany: async (keys: string[]) => keys.map(() => undefined),
      cacheSetMany: async () => undefined,
      cacheDeleteMany: async () => undefined,
      cacheKeys: async () => [],
    }));
    const cache = await import("@/app/lib/cache/gunBuilder");
    await cache.ensureAmmoItems(["m855", "gone"], "regular");
    const state = cache.getAmmoState("regular");
    expect(state.items.get("m855")?.traderName).toBe("Prapor");
    expect(state.missing.has("gone")).toBe(true);
    await cache.ensureAmmoItems(["m855", "gone"], "regular");
    expect(calls).toHaveLength(1);
    respond = () => [{ ...ammo("evil"), gridImageLink: "https://evil.example/x.png" }];
    await expect(cache.ensureAmmoItems(["evil"], "pve")).rejects.toThrow(/invalid/);
    expect(cache.isAmmoItem(ammo("ok", { traderLevel: 11 }))).toBe(false);
    expect(cache.isAmmoItem(ammo("ok", { damage: Number.POSITIVE_INFINITY }))).toBe(false);
    expect(cache.isAmmoItem(ammo("ok", { normalizedName: "" }))).toBe(true);
    // Offers carry the task that unlocks them and the preset they are for, and are checked too.
    const unlock = { id: "chem2", name: "Chemical - Part 2", trader: "Skier", minPlayerLevel: null };
    const offer = { trader: "Skier", priceRUB: 100, level: 1, taskUnlock: unlock, preset: "Default" };
    expect(cache.isAmmoItem(ammo("ok", { traderOffers: [offer], traderTask: "Chemical - Part 2" }))).toBe(true);
    expect(cache.isAmmoItem(ammo("ok", { traderOffers: [{ ...offer, taskUnlock: { ...unlock, id: "" } }] }))).toBe(false);
    // Malformed cache entries, cast past the types the way stored JSON is.
    const malformed = (extra: Record<string, unknown>) => ammo("ok", extra as Partial<AmmoItemData>);
    expect(cache.isAmmoItem(malformed({ traderOffers: [{ ...offer, priceRUB: "100" }] }))).toBe(false);
    expect(cache.isAmmoItem(ammo("ok", { traderOffers: [{ ...offer, level: 0 }] }))).toBe(false);
    expect(cache.isAmmoItem(malformed({ traderTask: 5 }))).toBe(false);
    vi.doUnmock("@/app/lib/api/transport");
    vi.doUnmock("@/app/lib/cache/store");
  });
});
