import { beforeEach, describe, expect, it, vi } from "vitest";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import {
  clearTarkovResourceCache,
  executeTarkovOperation,
} from "@/app/lib/api/tarkov-server";

const fixtures: Record<string, unknown> = {
  items: {
    data: {
      items: {
        weapon: {
          id: "weapon",
          name: "weapon-name",
          shortName: "weapon-short",
          normalizedName: "test-rifle",
          gridImageLink: "https://assets.tarkov.dev/weapon.webp",
          wikiLink: "https://example.com/weapon",
          width: 2,
          height: 1,
          weight: 3.5,
          basePrice: 25_000,
          lastLowPrice: 50_000,
          avg24hPrice: 55_000,
          changeLast48hPercent: 5,
          types: ["gun"],
          buyFromTrader: [{ trader: "trader", priceRUB: 40_000 }],
          sellToTrader: [{ trader: "trader", priceRUB: 20_000 }],
          properties: {
            propertiesType: "ItemPropertiesWeapon",
            ergonomics: 50,
            recoilVertical: 100,
            recoilHorizontal: 200,
            fireRate: 700,
            fireModes: ["single"],
            defaultAmmo: "ammo",
            defaultPreset: "preset",
            presets: ["preset"],
            slots: [
              {
                id: "slot",
                name: "slot-name",
                nameId: "mod_scope",
                required: true,
                filters: { allowedItems: ["mod"] },
              },
            ],
          },
        },
        mod: {
          id: "mod",
          name: "mod-name",
          shortName: "mod-short",
          normalizedName: "test-mod",
          weight: 0.2,
          lastLowPrice: 12_000,
          conflictingItems: ["other"],
          conflictingSlotIds: ["slot-2"],
          buyFromTrader: [{ trader: "trader", priceRUB: 10_000 }],
          properties: {
            propertiesType: "ItemPropertiesWeaponMod",
            ergonomics: -2,
            recoilModifier: -0.05,
          },
        },
        ammo: { id: "ammo", name: "ammo-name", normalizedName: "test-ammo" },
        preset: {
          id: "preset",
          name: "preset-name",
          normalizedName: "test-preset",
          properties: { propertiesType: "ItemPropertiesPreset", baseItem: "weapon" },
          containsItems: [{ item: "weapon", count: 1 }, { item: "mod", count: 1 }],
        },
        reward: { id: "reward", name: "reward-name", normalizedName: "reward" },
        key: { id: "key", name: "key-name", normalizedName: "test-key" },
      },
      fleaMarket: { sellOfferFeeRate: 0.03, sellRequirementFeeRate: 0.03 },
    },
  },
  items_en: {
    data: {
      "weapon-name": "Test Rifle",
      "weapon-short": "Rifle",
      "mod-name": "Test Mod",
      "mod-short": "Mod",
      "ammo-name": "Test Ammo",
      "preset-name": "Test Preset",
      "reward-name": "Reward",
      "key-name": "Test Key",
      "slot-name": "Scope",
      single: "Single fire",
    },
  },
  traders: {
    data: { trader: { id: "trader", name: "trader-name", normalizedName: "tester" } },
  },
  traders_en: { data: { "trader-name": "Tester" } },
  tasks: {
    data: {
      tasks: {
        task: {
          id: "task",
          name: "task-name",
          trader: "trader",
          minPlayerLevel: 10,
          wikiLink: "https://example.com/task",
          objectives: [{ description: "task-objective", items: ["weapon"] }],
        },
      },
    },
  },
  tasks_en: { data: { "task-name": "Test Task", "task-objective": "Find the rifle" } },
  barters: {
    data: [
      {
        trader: "trader",
        minTraderLevel: 2,
        taskUnlock: "task",
        requiredItems: [{ item: "weapon", count: 2 }],
        offeredItem: { item: "reward", count: 1 },
      },
    ],
  },
  crafts: {
    data: [
      {
        station: "station",
        level: 3,
        taskUnlock: "task",
        requiredItems: [{ item: "weapon", count: 1 }],
        productItem: { item: "reward", count: 2 },
      },
    ],
  },
  hideout: {
    data: { station: { id: "station", name: "station-name", normalizedName: "workbench" } },
  },
  hideout_en: { data: { "station-name": "Workbench" } },
  maps: {
    data: {
      maps: {
        map: {
          normalizedName: "factory",
          players: "5-6",
          raidDuration: 20,
          extracts: [
            {
              id: "extract",
              name: "extract-name",
              faction: "pmc",
              position: { x: 1, y: 2, z: 3 },
            },
          ],
          locks: [
            {
              lockType: "door",
              key: "key",
              position: { x: 2, y: 3, z: 4 },
            },
          ],
          lootContainers: [
            { lootContainer: "container", position: { x: 3, y: 4, z: 5 } },
          ],
          stationaryWeapons: [
            { stationaryWeapon: "turret", position: { x: 4, y: 5, z: 6 } },
          ],
        },
      },
      lootContainers: {
        container: { id: "container", name: "container-name", normalizedName: "crate" },
      },
      stationaryWeapons: {
        turret: { id: "turret", name: "turret-name", normalizedName: "turret" },
      },
    },
  },
  maps_en: {
    data: {
      "extract-name": "Gate",
      "container-name": "Supply crate",
      "turret-name": "Mounted gun",
    },
  },
};

beforeEach(() => {
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
      vi.advanceTimersByTime(5 * 60_000 + 1);
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

  it("localizes the catalog and returns only its narrow projection", async () => {
    const result = await executeTarkovOperation(TARKOV_OPERATIONS.itemCatalog, {
      gameMode: "regular",
    });
    expect(result).toContainEqual({
      id: "weapon",
      name: "Test Rifle",
      shortName: "Rifle",
      normalizedName: "test-rifle",
      gridImageLink: "https://assets.tarkov.dev/weapon.webp",
    });
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
    ).resolves.toEqual({ baseItemId: "weapon", itemIds: ["weapon", "mod"] });

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
            rewardItems: [{ item: { name: "Reward" }, quantity: 1 }],
          }),
        ],
        craftsUsing: [
          expect.objectContaining({
            level: 3,
            station: { name: "Workbench" },
            rewardItems: [{ item: { name: "Reward" }, quantity: 2 }],
          }),
        ],
      })
    );
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
        locks: [expect.objectContaining({ keyName: "Test Key" })],
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
