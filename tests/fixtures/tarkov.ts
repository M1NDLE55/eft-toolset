export function createTarkovFixtures(): Record<string, unknown> {
  return {
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
            buyFromTrader: [
              { trader: "trader", priceRUB: 45_000, minTraderLevel: 1 },
              { trader: "trader", priceRUB: 40_000, minTraderLevel: 3 },
            ],
            sellToTrader: [{ trader: "trader", priceRUB: 20_000 }],
            properties: {
              propertiesType: "ItemPropertiesWeapon",
              ergonomics: 50,
              recoilVertical: 100,
              recoilHorizontal: 200,
              fireRate: 700,
              fireModes: ["single"],
              defaultAmmo: "ammo",
              allowedAmmo: ["ammo", "mod"],
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
          ammo: {
            id: "ammo",
            name: "ammo-name",
            normalizedName: "test-ammo",
            buyFromTrader: [{ trader: "trader", priceRUB: 150, minTraderLevel: 2 }],
            properties: { propertiesType: "ItemPropertiesAmmo", caliber: "Caliber556x45NATO", damage: 54, penetrationPower: 31, armorDamage: 37, fragmentationChance: 0.5, initialSpeed: 922 },
          },
          preset: {
            id: "preset",
            name: "preset-name",
            normalizedName: "test-preset",
            properties: { propertiesType: "ItemPropertiesPreset", baseItem: "weapon" },
            containsItems: [{ item: "weapon", count: 1 }, { item: "mod", count: 2 }],
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
      data: {
        station: {
          id: "station",
          name: "station-name",
          normalizedName: "workbench",
          levels: [
            {
              level: 1,
              itemRequirements: [
                { item: "mod", count: 2, attributes: { foundInRaid: true } },
                { item: "weapon", count: 1, attributes: { foundInRaid: false } },
              ],
              bonuses: [{ type: "ExperienceRate", value: 0.1 }],
            },
            {
              level: 2,
              itemRequirements: [{ item: "mod", count: 3, attributes: { foundInRaid: false } }],
              bonuses: [{ type: "AdditionalSlots", value: 5, slotItems: ["mod"] }],
            },
          ],
        },
      },
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
}
