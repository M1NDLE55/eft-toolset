import { describe, expect, it, vi } from "vitest";
import type { BuildItemData, BuildNode, ModSlotDef, PriceSources } from "@/app/lib/types/gunBuilder";
import { optimizeBuild, type OptimizeOptions } from "@/app/lib/builds/optimizer";
import { findConflicts } from "@/app/lib/builds/conflicts";
import { diffBuildTrees, statDeltas, treesEqual } from "@/app/lib/builds/compare";
import { buildShoppingList, formatShoppingList } from "@/app/lib/builds/shopping";
import { computeStats } from "@/app/lib/builds/stats";
import { collectItemIds } from "@/app/lib/builds/tree";
import { extractSharePayload, parseSharedBuildInput } from "@/app/lib/builds/share-import";
import { encodeBuildSharePayload } from "@/app/lib/builds/share";
import { encodeSharePayload } from "@/app/lib/share-codec";

const BOTH: PriceSources = { traders: true, flea: true };

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

function lookup(...items: BuildItemData[]) {
  return new Map(items.map((entry) => [entry.id, entry]));
}

function gun(slots: ModSlotDef[], extra: Partial<BuildItemData> = {}) {
  return item("gun", { isWeapon: true, ergonomics: 40, recoilVertical: 100, recoilHorizontal: 200, slots, ...extra });
}

const bare: BuildNode = { itemId: "gun", slots: {} };
const noPause = { pause: async () => undefined };

function optimize(root: BuildNode, data: Map<string, BuildItemData>, options: Partial<OptimizeOptions>) {
  return optimizeBuild(root, data, { goal: "ergonomics", priceSources: BOTH, ...options }, noPause);
}

function allowedEverywhere(root: BuildNode, data: Map<string, BuildItemData>) {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const defs = data.get(node.itemId)?.slots ?? [];
    for (const [slotId, child] of Object.entries(node.slots)) {
      const def = defs.find((entry) => entry.id === slotId);
      if (!def || !def.allowedItemIds.includes(child.itemId)) return false;
      stack.push(child);
    }
  }
  return true;
}

describe("optimiser", () => {
  it("picks the best compatible part per slot and nests sub-parts", async () => {
    const data = lookup(
      gun([slot("grip", ["g1", "g2"]), slot("stock", ["s1", "s2"])]),
      item("g1", { ergonomics: 4 }),
      item("g2", { ergonomics: 9 }),
      item("s1", { ergonomics: 2, slots: [slot("pad", ["p1"])] }),
      item("s2", { ergonomics: 5 }),
      item("p1", { ergonomics: 6 }),
      item("outsider", { ergonomics: 99 })
    );
    const result = await optimize(bare, data, {});
    expect(result.root).toEqual({
      itemId: "gun",
      slots: { grip: { itemId: "g2", slots: {} }, stock: { itemId: "s1", slots: { pad: { itemId: "p1", slots: {} } } } },
    });
    expect(collectItemIds(result.root)).not.toContain("outsider");
    expect(allowedEverywhere(result.root, data)).toBe(true);
    expect(computeStats(result.root, data, BOTH).ergonomics).toBe(40 + 9 + 2 + 6);
  });

  it("fills required slots even when every option hurts, but leaves harmful optional slots empty", async () => {
    const data = lookup(
      gun([slot("mag", ["m1", "m2"], { required: true }), slot("scope", ["sc"])]),
      item("m1", { ergonomics: -5 }),
      item("m2", { ergonomics: -2 }),
      item("sc", { ergonomics: -1 })
    );
    const result = await optimize(bare, data, {});
    expect(result.root.slots).toEqual({ mag: { itemId: "m2", slots: {} } });
  });

  it("minimises recoil modifiers for the recoil goal", async () => {
    const data = lookup(
      gun([slot("muzzle", ["brake", "comp"])]),
      item("brake", { recoilModifier: -0.12, ergonomics: -3 }),
      item("comp", { recoilModifier: -0.05, ergonomics: 2 })
    );
    const result = await optimize(bare, data, { goal: "recoil" });
    expect(result.root.slots.muzzle.itemId).toBe("brake");
    expect(computeStats(result.root, data, BOTH).recoilVertical).toBeCloseTo(88);
  });

  it("never returns parts that conflict with each other", async () => {
    const data = lookup(
      gun([slot("hg", ["hgA", "hgB"]), slot("gas", ["gasA", "gasB"])]),
      item("hgA", { ergonomics: 10, conflictingItemIds: ["gasA"] }),
      item("hgB", { ergonomics: 6 }),
      item("gasA", { ergonomics: 8 }),
      item("gasB", { ergonomics: 1 })
    );
    const result = await optimize(bare, data, {});
    expect(findConflicts(result.root, data)).toEqual([]);
    expect(result.conflicts).toBe(0);
    expect(computeStats(result.root, data, BOTH).ergonomics).toBe(40 + 6 + 8);
  });

  it("respects parts that block slots elsewhere on the weapon", async () => {
    const data = lookup(
      gun([slot("top", ["bigScope", "dot"]), slot("rear", ["sight"])]),
      item("bigScope", { ergonomics: 7, conflictingSlotIds: ["rear"] }),
      item("dot", { ergonomics: 2 }),
      item("sight", { ergonomics: 3 })
    );
    const result = await optimize(bare, data, {});
    expect(findConflicts(result.root, data)).toEqual([]);
    expect(result.root.slots).toEqual({ top: { itemId: "bigScope", slots: {} } });
  });

  it("finds the best build that fits a budget", async () => {
    const data = lookup(
      gun([slot("grip", ["cheap", "mid", "luxury"]), slot("stock", ["s1", "s2"])], { traderPriceRUB: 10_000 }),
      item("cheap", { ergonomics: 1, traderPriceRUB: 1_000 }),
      item("mid", { ergonomics: 5, traderPriceRUB: 4_000 }),
      item("luxury", { ergonomics: 9, traderPriceRUB: 50_000 }),
      item("s1", { ergonomics: 3, traderPriceRUB: 2_000 }),
      item("s2", { ergonomics: 8, traderPriceRUB: 30_000 })
    );
    const unlimited = await optimize(bare, data, {});
    expect(unlimited.costRUB).toBe(90_000);
    const result = await optimize(bare, data, { budget: 17_000 });
    expect(result.withinBudget).toBe(true);
    expect(result.costRUB).toBeLessThanOrEqual(17_000);
    expect(result.root.slots).toEqual({ grip: { itemId: "mid", slots: {} }, stock: { itemId: "s1", slots: {} } });
    const impossible = await optimize(bare, data, { budget: 5_000 });
    expect(impossible.withinBudget).toBe(false);
    expect(impossible.costRUB).toBe(10_000);
  });

  it("keeps installed parts when replacing is off and only fills empty slots", async () => {
    const data = lookup(
      gun([slot("grip", ["g1", "g2"]), slot("stock", ["s1"])]),
      item("g1", { ergonomics: 1 }),
      item("g2", { ergonomics: 9 }),
      item("s1", { ergonomics: 4 })
    );
    const root: BuildNode = { itemId: "gun", slots: { grip: { itemId: "g1", slots: {} } } };
    const result = await optimize(root, data, { replaceExisting: false });
    expect(result.root.slots.grip.itemId).toBe("g1");
    expect(result.root.slots.stock.itemId).toBe("s1");
  });

  it("keeps occupied slots filled, even when optimising cost", async () => {
    const data = lookup(
      gun([slot("scope", ["pricey", "budget"])]),
      item("pricey", { traderPriceRUB: 90_000, ergonomics: -1 }),
      item("budget", { traderPriceRUB: 5_000, ergonomics: -2 })
    );
    const root: BuildNode = { itemId: "gun", slots: { scope: { itemId: "pricey", slots: {} } } };
    const result = await optimize(root, data, { goal: "cost" });
    expect(result.root.slots).toEqual({ scope: { itemId: "budget", slots: {} } });
    expect(result.changed).toBe(true);
  });

  it("keeps sub-parts of a replaced part in matching slots where possible", async () => {
    const data = lookup(
      gun([slot("hg", ["hgOld", "hgNew"])]),
      item("hgOld", { ergonomics: 1, slots: [slot("rail_000", ["fg"], { nameId: "mod_foregrip_000" })] }),
      item("hgNew", { ergonomics: 6, slots: [slot("rail_new", ["fg"], { nameId: "mod_foregrip_001" })] }),
      item("fg", { ergonomics: -1 })
    );
    const root: BuildNode = {
      itemId: "gun",
      slots: { hg: { itemId: "hgOld", slots: { rail_000: { itemId: "fg", slots: {} } } } },
    };
    const result = await optimize(root, data, {});
    expect(result.root.slots.hg).toEqual({ itemId: "hgNew", slots: { rail_new: { itemId: "fg", slots: {} } } });
  });

  it("fills one target slot with the cheapest part and its required sub-parts", async () => {
    const data = lookup(
      gun([slot("upper", ["u1", "u2"], { required: true }), slot("grip", ["g"], { required: true })]),
      item("u1", { traderPriceRUB: 5_000, slots: [slot("barrel", ["b1", "b2"], { required: true }), slot("top", ["t"])] }),
      item("u2", { traderPriceRUB: 2_000, slots: [slot("barrel", ["b3"], { required: true })] }),
      item("b1", { traderPriceRUB: 100 }),
      item("b2", { traderPriceRUB: 200 }),
      item("b3", { traderPriceRUB: 9_000 }),
      item("t", { traderPriceRUB: 10, ergonomics: 30 }),
      item("g", { traderPriceRUB: 10 })
    );
    const target = await optimize(bare, data, { goal: "cost", replaceExisting: false, target: { parentPath: [], slotId: "upper" } });
    expect(target.root).toEqual({
      itemId: "gun",
      slots: { upper: { itemId: "u1", slots: { barrel: { itemId: "b1", slots: {} } } } },
    });
    const all = await optimize(bare, data, { goal: "cost", replaceExisting: false });
    expect(Object.keys(all.root.slots).sort()).toEqual(["grip", "upper"]);
    expect(computeStats(all.root, data, BOTH).missingRequired).toEqual([]);
  });

  it("skips unpriced parts unless allowed, but keeps an installed unpriced part", async () => {
    const data = lookup(
      gun([slot("grip", ["barter", "shop"]), slot("stock", ["quest"])]),
      item("barter", { ergonomics: 12, traderPriceRUB: null }),
      item("shop", { ergonomics: 3 }),
      item("quest", { ergonomics: 7, traderPriceRUB: null })
    );
    const priced = await optimize(bare, data, {});
    expect(priced.root.slots).toEqual({ grip: { itemId: "shop", slots: {} } });
    const unpriced = await optimize(bare, data, { allowUnpriced: true });
    expect(unpriced.root.slots.grip.itemId).toBe("barter");
    const installed: BuildNode = { itemId: "gun", slots: { stock: { itemId: "quest", slots: {} } } };
    const kept = await optimize(installed, data, {});
    expect(kept.root.slots.stock.itemId).toBe("quest");
  });

  it("uses only the selected price sources", async () => {
    const data = lookup(
      gun([slot("grip", ["a", "b"], { required: true })]),
      item("a", { traderPriceRUB: 500, fleaPriceRUB: null }),
      item("b", { traderPriceRUB: null, fleaPriceRUB: 100 })
    );
    const flea = await optimize(bare, data, { goal: "cost", priceSources: { traders: false, flea: true } });
    expect(flea.root.slots.grip.itemId).toBe("b");
    const traders = await optimize(bare, data, { goal: "cost", priceSources: { traders: true, flea: false } });
    expect(traders.root.slots.grip.itemId).toBe("a");
  });

  it("does not recurse forever on self-referencing data", async () => {
    const data = lookup(gun([slot("a", ["loop"])]), item("loop", { ergonomics: 1, slots: [slot("again", ["loop"])] }));
    const result = await optimize(bare, data, {});
    expect(result.root.slots.a.itemId).toBe("loop");
  });

  it("stops when aborted and refuses to run without weapon details", async () => {
    const data = lookup(gun([slot("grip", ["g"])]), item("g", { ergonomics: 1 }));
    const controller = new AbortController();
    controller.abort();
    await expect(
      optimizeBuild(bare, data, { goal: "ergonomics", priceSources: BOTH }, { signal: controller.signal, ...noPause })
    ).rejects.toBeDefined();
    await expect(optimize({ itemId: "missing", slots: {} }, data, {})).rejects.toThrow(/weapon details/i);
  });
});

describe("conflict detection", () => {
  it("reports item and slot conflicts once each", () => {
    const data = lookup(
      gun([slot("a", ["x"]), slot("b", ["y"]), slot("c", ["z"])]),
      item("x", { conflictingItemIds: ["y"] }),
      item("y", { conflictingItemIds: ["x"] }),
      item("z", { conflictingSlotIds: ["a"] })
    );
    const root: BuildNode = {
      itemId: "gun",
      slots: { a: { itemId: "x", slots: {} }, b: { itemId: "y", slots: {} }, c: { itemId: "z", slots: {} } },
    };
    const conflicts = findConflicts(root, data);
    expect(conflicts.map((entry) => entry.kind).sort()).toEqual(["item", "slot"]);
  });
});

describe("build comparison", () => {
  const data = lookup(
    gun([slot("hg", ["hgA", "hgB"], { name: "Handguard", nameId: "mod_handguard" }), slot("grip", ["g1", "g2"])]),
    item("hgA", { slots: [slot("a_rail", ["fg"], { name: "Foregrip", nameId: "mod_foregrip_000" })] }),
    item("hgB", { slots: [slot("b_rail", ["fg", "fg2"], { name: "Foregrip", nameId: "mod_foregrip_001" })] }),
    item("fg"),
    item("fg2"),
    item("g1"),
    item("g2")
  );

  it("aligns slots by role even when parent parts differ", () => {
    const left: BuildNode = {
      itemId: "gun",
      slots: { hg: { itemId: "hgA", slots: { a_rail: { itemId: "fg", slots: {} } } }, grip: { itemId: "g1", slots: {} } },
    };
    const right: BuildNode = { itemId: "gun", slots: { hg: { itemId: "hgB", slots: { b_rail: { itemId: "fg", slots: {} } } } } };
    const rows = diffBuildTrees(left, right, data);
    expect(rows.map((row) => [row.label, row.left, row.right, row.status, row.depth])).toEqual([
      ["Handguard", "hgA", "hgB", "changed", 0],
      ["Foregrip", "fg", "fg", "same", 1],
      ["grip", "g1", null, "removed", 0],
    ]);
    expect(rows[1].context).toEqual(["Handguard"]);
    expect(diffBuildTrees(right, left, data)[2].status).toBe("added");
  });

  it("reports stat deltas with better and worse verdicts", () => {
    const base = computeStats(bare, data, BOTH);
    const deltas = statDeltas(base, { ...base, ergonomics: 50, weight: base.weight + 1, costRUB: null });
    const byKey = Object.fromEntries(deltas.map((row) => [row.key, row]));
    expect(byKey.ergonomics).toMatchObject({ delta: 10, verdict: "better" });
    expect(byKey.weight).toMatchObject({ delta: 1, verdict: "worse" });
    expect(byKey.costRUB).toMatchObject({ delta: null, verdict: null });
    expect(byKey.partCount.verdict).toBe("even");
  });

  it("compares trees structurally", () => {
    const a: BuildNode = { itemId: "gun", slots: { x: { itemId: "a", slots: {} } } };
    expect(treesEqual(a, JSON.parse(JSON.stringify(a)))).toBe(true);
    expect(treesEqual(a, { itemId: "gun", slots: { y: { itemId: "a", slots: {} } } })).toBe(false);
    expect(treesEqual(a, bare)).toBe(false);
  });
});

describe("shopping list", () => {
  const data = lookup(
    gun([slot("a", ["panel"]), slot("b", ["panel"]), slot("c", ["sight"]), slot("d", ["free"])], {
      name: "Test Rifle",
      traderPriceRUB: 20_000,
      fleaPriceRUB: 25_000,
    }),
    item("panel", { name: "Rail `panel`\nlong", traderPriceRUB: 3_000, fleaPriceRUB: 2_500 }),
    item("sight", { name: "Sight", traderPriceRUB: 4_000, fleaPriceRUB: 4_000, traderName: "Prapor", traderLevel: 2 }),
    item("free", { name: "Barter thing", traderPriceRUB: null, fleaPriceRUB: null })
  );
  const root: BuildNode = {
    itemId: "gun",
    slots: {
      a: { itemId: "panel", slots: {} },
      b: { itemId: "panel", slots: {} },
      c: { itemId: "sight", slots: {} },
      d: { itemId: "free", slots: {} },
    },
  };

  it("groups duplicates, picks the cheaper source and totals correctly", () => {
    const list = buildShoppingList(root, data, BOTH);
    expect(list.rows.map((row) => [row.itemId, row.count, row.source, row.subtotalRUB])).toEqual([
      ["gun", 1, "trader", 20_000],
      ["panel", 2, "flea", 5_000],
      ["sight", 1, "trader", 4_000],
      ["free", 1, null, null],
    ]);
    expect(list.totalRUB).toBe(29_000);
    expect(list.itemCount).toBe(5);
    expect(list.unpricedCount).toBe(1);
    expect(list.totalRUB).toBe(computeStats(root, data, BOTH).costRUB);
  });

  it("honours price sources and can leave out the weapon", () => {
    const list = buildShoppingList(root, data, { traders: true, flea: false }, false);
    expect(list.rows.map((row) => row.itemId)).toEqual(["panel", "sight", "free"]);
    expect(list.totalRUB).toBe(10_000);
  });

  it("formats a Discord-safe code block", () => {
    const text = formatShoppingList(buildShoppingList(root, data, BOTH), {
      buildName: "My @everyone build",
      weaponName: "Test Rifle",
      modeLabel: "PVP",
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("**My @\u200beveryone build** · Test Rifle · PVP prices");
    expect(lines.filter((line) => line === "```")).toHaveLength(2);
    expect(text.slice(text.indexOf("```") + 3, text.lastIndexOf("```"))).not.toContain("`");
    expect(text).toContain("Rail 'panel' long".replace(/'/g, " ").replace(/\s+/g, " "));
    expect(text).toContain("Total: 29,000 RUB for 5 items (1 item without a price)");
    expect(text).toContain("Prapor LL2");
    const header = lines[2];
    const body = lines.slice(4, 8);
    for (const line of body) expect(line.length).toBeLessThanOrEqual(header.length + 16);
  });
});

describe("share link import", () => {
  const build = {
    id: "id",
    name: "Imported",
    weaponId: "gun",
    root: { itemId: "gun", slots: { a: { itemId: "x", slots: {} } } },
    createdAt: 0,
    updatedAt: 0,
  };

  it("accepts full links, relative links and bare payloads", async () => {
    const payload = await encodeBuildSharePayload(build);
    const links = [
      `https://eft-toolset.com/gun-builder/share/imported#b=${payload}`,
      `http://localhost:3000/gun-builder/share/imported/#b=${payload}`,
      `/gun-builder/share/imported#b=${payload}`,
      `  ${payload}  `,
    ];
    for (const link of links) expect(extractSharePayload(link)).toBe(payload);
    await expect(parseSharedBuildInput(links[0])).resolves.toEqual({ name: "Imported", weaponId: "gun", root: build.root, ammoId: null });
  });

  it("rejects anything that is not a strict share link", async () => {
    const payload = await encodeBuildSharePayload(build);
    const rejected = [
      "",
      "hello world",
      `javascript:alert(1)//#b=${payload}`,
      `data:text/html,x#b=${payload}`,
      `https://eft-toolset.com/gun-builder/other/imported#b=${payload}`,
      `https://eft-toolset.com/gun-builder/share/Imported#b=${payload}`,
      `https://eft-toolset.com/gun-builder/share/imported?x=1#b=${payload}`,
      `https://eft-toolset.com/gun-builder/share/imported#b=${payload}&n=2`,
      `https://eft-toolset.com/gun-builder/share/imported#c=${payload}`,
      `https://user:pass@eft-toolset.com/gun-builder/share/imported#b=${payload}`,
      `https://eft-toolset.com/gun-builder/share/../share/x#b=<script>`,
      `https://eft-toolset.com/gun-builder/share/imported#b=${payload} https://x.y`,
      `gun-builder/share/imported#b=${payload}`,
      `https://eft-toolset.com/gun-builder/share/imported#b=${"A".repeat(402_100)}`,
    ];
    for (const value of rejected) expect(() => extractSharePayload(value), value.slice(0, 80)).toThrow();
  });

  it("rejects payloads that decode to an invalid recipe", async () => {
    const tampered = await encodeSharePayload({ v: 1, w: "gun", r: ["other"] });
    await expect(parseSharedBuildInput(`/gun-builder/share/x#b=${tampered}`)).rejects.toThrow(/damaged/i);
    const badName = await encodeSharePayload({ v: 1, w: "gun", n: "x".repeat(500), r: ["gun"] });
    await expect(parseSharedBuildInput(badName)).rejects.toThrow(/damaged/i);
    await expect(parseSharedBuildInput("gz.AAAAAAAAAAAA")).rejects.toThrow(/damaged/i);
  });
});

describe("compatibility graph loading", () => {
  it("follows only required slots when asked and caps the request size", async () => {
    vi.resetModules();
    const requested: string[][] = [];
    const catalog = new Map<string, BuildItemData>([
      ["root", item("root", { slots: [slot("req", ["r1"], { required: true }), slot("opt", ["o1"])] })],
      ["r1", item("r1", { slots: [slot("deep", ["r2"], { required: true })] })],
      ["r2", item("r2")],
      ["o1", item("o1")],
    ]);
    vi.doMock("@/app/lib/api/transport", () => ({
      apiFetch: async (_operation: string, variables: { ids: string[] }) => {
        requested.push(variables.ids);
        return variables.ids.flatMap((id) => (catalog.has(id) ? [catalog.get(id)] : []));
      },
    }));
    vi.doMock("@/app/lib/cache/store", () => ({
      cacheGetMany: async (keys: string[]) => keys.map(() => undefined),
      cacheSetMany: async () => undefined,
      cacheDeleteMany: async () => undefined,
      cacheKeys: async () => [],
    }));
    const cache = await import("@/app/lib/cache/gunBuilder");
    const result = await cache.loadCompatibilityGraph(["root"], "regular", { requiredOnly: true });
    expect(result).toEqual({ count: 3, truncated: false });
    expect(requested.flat().sort()).toEqual(["r1", "r2", "root"]);
    const full = await cache.loadCompatibilityGraph(["root"], "pve");
    expect(full.count).toBe(4);
    vi.doUnmock("@/app/lib/api/transport");
    vi.doUnmock("@/app/lib/cache/store");
  });
});
