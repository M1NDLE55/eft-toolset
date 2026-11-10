import { beforeEach, describe, expect, it, vi } from "vitest";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import {
  clearTarkovResourceCache,
  executeTarkovOperation,
} from "@/app/lib/api/tarkov-server";
import { createTarkovFixtures } from "./fixtures/tarkov";

let fixtures: Record<string, unknown> = createTarkovFixtures();

beforeEach(() => {
  fixtures = createTarkovFixtures();
  clearTarkovResourceCache();
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

describe("Tarkov JSON adapter", () => {
  it("rejects malformed resource shapes before they enter the cache", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const resource = new URL(String(input)).pathname.split("/").pop()!;
      const body = resource === "items" ? { data: { items: [] } } : fixtures[resource];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await expect(
      executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular" })
    ).rejects.toThrow(/invalid items data/i);
  });

  it("drops unsafe projected URLs", async () => {
    const weapon = (fixtures.items as { data: { items: { weapon: Record<string, unknown> } } }).data.items.weapon;
    const originalImage = weapon.gridImageLink;
    const originalWiki = weapon.wikiLink;
    weapon.gridImageLink = "javascript:alert(1)";
    weapon.wikiLink = "javascript:alert(1)";
    try {
      const detail = await executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, {
        gameMode: "regular",
        name: "Test Rifle",
      }) as { gridImageLink: string | null; wikiLink: string | null };
      expect(detail.gridImageLink).toBeNull();
      expect(detail.wikiLink).toBeNull();
    } finally {
      weapon.gridImageLink = originalImage;
      weapon.wikiLink = originalWiki;
    }
  });

  it("serves a bounded stale copy when an upstream refresh fails and reports it", async () => {
    vi.useFakeTimers();
    try {
      const initial = await executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, {
        gameMode: "regular",
      });
      vi.advanceTimersByTime(31 * 60_000);
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error("offline"));
      const onStale = vi.fn();
      const secondOnStale = vi.fn();
      const firstRequest = executeTarkovOperation(
          TARKOV_OPERATIONS.itemCatalog,
          { gameMode: "regular" },
          { onStale }
      );
      const deduplicatedRequest = executeTarkovOperation(
        TARKOV_OPERATIONS.itemCatalog,
        { gameMode: "regular" },
        { onStale: secondOnStale }
      );
      await expect(firstRequest).resolves.toEqual(initial);
      await expect(deduplicatedRequest).resolves.toEqual(initial);
      expect(onStale).toHaveBeenCalledOnce();
      expect(secondOnStale).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("revalidates in the background without making callers wait", async () => {
    vi.useFakeTimers();
    try {
      const initial = await executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular" });
      vi.advanceTimersByTime(10 * 60_000);
      let release: (() => void) | undefined;
      vi.mocked(globalThis.fetch).mockImplementation(
        () => new Promise((resolve) => {
          release = () => resolve(new Response("{}", { status: 500 }));
        })
      );
      const onStale = vi.fn();
      await expect(
        executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular" }, { onStale })
      ).resolves.toEqual(initial);
      expect(onStale).not.toHaveBeenCalled();
      expect(release).toBeDefined();
      release?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to serve data older than the stale limit when upstream is down", async () => {
    vi.useFakeTimers();
    try {
      await executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular" });
      vi.advanceTimersByTime(7 * 60 * 60_000);
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error("offline"));
      await expect(
        executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular" })
      ).rejects.toMatchObject({ name: "TarkovUpstreamError" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fail other callers when one caller disconnects during a shared load", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          const resource = new URL(String(input)).pathname.split("/").pop()!;
          setTimeout(() => resolve(new Response(JSON.stringify(fixtures[resource]), { status: 200 })), 10);
        })
    );
    const controller = new AbortController();
    const first = executeTarkovOperation(
      TARKOV_OPERATIONS.itemCatalog,
      { gameMode: "regular" },
      { signal: controller.signal }
    );
    const second = executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular" });
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toContainEqual(["weapon", "Test Rifle", "Rifle", "weapon.webp", "test-rifle"]);
  });

  it("rejects variables the operation does not declare", async () => {
    await expect(
      executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular", extra: 1 })
    ).rejects.toMatchObject({ name: "TarkovRequestError" });
  });

  it("looks items up by slug and requires exactly one of name or slug", async () => {
    await expect(
      executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, { gameMode: "regular", slug: "test-rifle" })
    ).resolves.toMatchObject({ name: "Test Rifle", normalizedName: "test-rifle" });
    await expect(
      executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, { gameMode: "regular", slug: "missing" })
    ).resolves.toBeNull();
    for (const variables of [
      { gameMode: "regular" },
      { gameMode: "regular", name: "Test Rifle", slug: "test-rifle" },
      { gameMode: "regular", slug: "Bad Slug" },
    ]) {
      await expect(executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, variables)).rejects.toMatchObject({
        name: "TarkovRequestError",
      });
    }
  });

  it("localizes the catalog and returns only its narrow projection", async () => {
    const result = await executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, {
      gameMode: "regular",
    });
    expect(result).toContainEqual(["weapon", "Test Rifle", "Rifle", "weapon.webp", "test-rifle"]);
  });

  it("joins item, pricing, slot, and preset data", async () => {
    const builds = await executeTarkovOperation(TARKOV_OPERATIONS.buildItems, {
      gameMode: "regular",
      ids: ["weapon", "mod"],
    });
    expect(builds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "weapon",
          traderPriceRUB: 40_000,
          fleaPriceRUB: 55_000,
          defaultAmmoName: "Test Ammo",
          defaultPresetId: "preset",
          slots: [expect.objectContaining({ name: "Scope", allowedItemIds: ["mod"] })],
        }),
        expect.objectContaining({
          id: "mod",
          ergonomics: -2,
          recoilModifier: -0.05,
          conflictingItemIds: ["other"],
        }),
      ])
    );

    await expect(
      executeTarkovOperation(TARKOV_OPERATIONS.preset, {
        gameMode: "regular",
        id: "preset",
      })
    ).resolves.toEqual({ baseItemId: "weapon", itemIds: ["weapon", "mod", "mod"] });

    await expect(
      executeTarkovOperation(TARKOV_OPERATIONS.pickItems, {
        gameMode: "regular",
        ids: ["mod"],
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "mod",
        traderPriceRUB: 10_000,
        fleaPriceRUB: 12_000,
        recoilModifier: -0.05,
      }),
    ]);
  });

  it("projects trader details, allowed ammo, and ammo stats", async () => {
    const [weapon] = (await executeTarkovOperation(TARKOV_OPERATIONS.buildItems, {
      gameMode: "regular",
      ids: ["weapon"],
    })) as Record<string, unknown>[];
    expect(weapon).toMatchObject({
      normalizedName: "test-rifle",
      traderPriceRUB: 40_000,
      traderName: "Tester",
      traderLevel: 3,
      allowedAmmoIds: ["ammo"],
    });
    await expect(
      executeTarkovOperation(TARKOV_OPERATIONS.ammoItems, { gameMode: "regular", ids: ["ammo", "mod"] })
    ).resolves.toEqual([
      expect.objectContaining({ id: "ammo", damage: 54, penetrationPower: 31, projectileCount: 1, traderLevel: 2 }),
    ]);
  });

  it("composes task, barter, craft, and trader relations", async () => {
    const detail = await executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, {
      gameMode: "regular",
      name: "Test Rifle",
    });
    expect(detail).toEqual(
      expect.objectContaining({
        name: "Test Rifle",
        buyFor: expect.arrayContaining([
          { vendor: { name: "Tester" }, priceRUB: 40_000 },
          { vendor: { name: "Flea Market" }, priceRUB: 55_000 },
        ]),
        sellFor: expect.arrayContaining([
          { vendor: { name: "Flea Market" }, priceRUB: 50_000 },
        ]),
        fleaMarketFee: expect.any(Number),
        usedInTasks: [
          expect.objectContaining({
            name: "Test Task",
            trader: { name: "Tester" },
            objectives: [{ description: "Find the rifle" }],
          }),
        ],
        bartersUsing: [
          expect.objectContaining({
            level: 2,
            trader: { name: "Tester" },
            rewardItems: [{ item: { name: "Reward", normalizedName: "reward" }, quantity: 1 }],
          }),
        ],
        craftsUsing: [
          expect.objectContaining({
            level: 3,
            station: { name: "Workbench" },
            rewardItems: [{ item: { name: "Reward", normalizedName: "reward" }, quantity: 2 }],
          }),
        ],
      })
    );
  });

  it("lists only tasks and objectives that need the item, not any-item objectives", async () => {
    // tarkov.dev expands "Sell any items to <trader>" into every sellable item ID.
    const everyItem = ["weapon", ...Array.from({ length: 3_300 }, (_, index) => `filler-${index}`)];
    const tasks = fixtures.tasks as { data: { tasks: Record<string, unknown> } };
    tasks.data.tasks["any-item"] = {
      id: "any-item",
      name: "any-item-name",
      trader: "trader",
      objectives: [
        { description: "sell-any", type: "sellItem", items: everyItem },
        { description: "sell-any", type: "sellItem", items: [] },
      ],
    };
    tasks.data.tasks.mixed = {
      id: "mixed",
      name: "mixed-name",
      trader: "trader",
      objectives: [
        { description: "sell-any", type: "sellItem", items: everyItem },
        { description: "extract", type: "extract" },
        { description: "plant-rifle", type: "plantItem", items: ["weapon", "mod"] },
      ],
    };
    Object.assign((fixtures.tasks_en as { data: Record<string, string> }).data, {
      "any-item-name": "Any Item Task",
      "mixed-name": "Mixed Task",
      "sell-any": "Sell any items to Tester",
      extract: "Survive and extract",
      "plant-rifle": "Stash the rifle",
    });

    const detail = await executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, {
      gameMode: "regular",
      name: "Test Rifle",
    }) as { usedInTasks: { name: string; objectives: { description: string | null }[] }[] };
    expect(
      detail.usedInTasks.map(({ name, objectives }) => ({ name, objectives }))
    ).toEqual([
      { name: "Test Task", objectives: [{ description: "Find the rifle" }] },
      { name: "Mixed Task", objectives: [{ description: "Stash the rifle" }] },
    ]);

    const [group] = await executeTarkovOperation(TARKOV_OPERATIONS.groupItems, {
      gameMode: "regular",
      names: ["Test Rifle"],
    }) as { usedInTasks: { name: string }[] }[];
    expect(group.usedInTasks).toEqual([{ name: "Test Task" }, { name: "Mixed Task" }]);

    const modDetail = await executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, {
      gameMode: "regular",
      name: "Test Mod",
    }) as { usedInTasks: { name: string }[] };
    expect(modDetail.usedInTasks.map(({ name }) => name)).toEqual(["Mixed Task"]);
  });

  it("joins map reference IDs without exposing the bulk map payload", async () => {
    const map = await executeTarkovOperation(TARKOV_OPERATIONS.mapDetails, {
      gameMode: "regular",
      mapKey: "factory",
    });
    expect(map).toEqual(
      expect.objectContaining({
        key: "factory",
        extracts: [expect.objectContaining({ name: "Gate" })],
        locks: [expect.objectContaining({ keyName: "Test Key", keyNormalizedName: "test-key" })],
        lootContainers: [
          expect.objectContaining({ typeId: "crate", typeName: "Supply crate" }),
        ],
        stationaryWeapons: [expect.objectContaining({ name: "Mounted gun" })],
      })
    );
  });

  it("rejects variables outside the operation contract", async () => {
    await expect(
      executeTarkovOperation(TARKOV_OPERATIONS.buildItems, {
        gameMode: "regular",
        ids: Array.from({ length: 101 }, (_, index) => String(index)),
      })
    ).rejects.toMatchObject({ name: "TarkovRequestError" });
  });

  it("deduplicates upstream resource loads within the server TTL", async () => {
    await executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular" });
    await executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, { gameMode: "regular" });

    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.endsWith("/items"))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith("/items_en"))).toHaveLength(1);
  });

  it("stops waiting promptly when the caller disconnects", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          const resource = new URL(String(input)).pathname.split("/").pop()!;
          setTimeout(
            () => resolve(new Response(JSON.stringify(fixtures[resource]), { status: 200 })),
            25
          );
        })
    );
    const controller = new AbortController();
    const request = executeTarkovOperation(
      TARKOV_OPERATIONS.itemCatalog,
      { gameMode: "regular" },
      { signal: controller.signal }
    );

    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
});
