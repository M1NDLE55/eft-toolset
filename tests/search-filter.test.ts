import { describe, expect, it } from "vitest";
import { filterCatalog, listCatalog, MAX_SEARCH_RESULTS, searchCatalog, suggestNames } from "@/app/lib/search/filter-catalog";
import type { CatalogItem } from "@/app/lib/cache/types";

function item(name: string, shortName: string | null = null, id = name): CatalogItem {
  return { id, normalizedName: null, name, shortName, gridImageLink: null };
}

describe("catalog search", () => {
  it("matches case-insensitively, excludes selected names, and never exceeds its result cap", () => {
    const items = Array.from({ length: 40 }, (_, index) => item(`Test item ${index}`, `Item ${index}`));
    const result = filterCatalog(items, "TEST ITEM", ["Test item 0"], 1_000);

    expect(result).toHaveLength(MAX_SEARCH_RESULTS);
    expect(result.map((entry) => entry.name)).not.toContain("Test item 0");
  });

  it("matches every word in any order across the name and short name", () => {
    const items = [
      item("Salewa first aid kit", "Salewa"),
      item("AI-2 medkit", "AI-2"),
      item("Car first aid kit", "Car"),
    ];
    expect(filterCatalog(items, "kit salewa").map((entry) => entry.name)).toEqual([
      "Salewa first aid kit",
    ]);
  });

  it("ranks exact short names and prefixes ahead of substring matches", () => {
    const items = [
      item("Gas analyzer", "GasAn"),
      item("Graphics card", "GPU"),
      item("Sliding GPU rack", "Rack"),
    ];
    expect(filterCatalog(items, "gpu")[0].name).toBe("Graphics card");
    expect(filterCatalog(items, "ga")[0].name).toBe("Gas analyzer");
  });

  it("collapses duplicate names", () => {
    const items = [item("Ammo pack", "P", "a"), item("Ammo pack", "P", "b")];
    expect(filterCatalog(items, "ammo")).toHaveLength(1);
  });
});

describe("catalog search ordering and typo tolerance", () => {
  const bitcoins = [
    item("Left half of a Physical Bitcoin", "BTC"),
    item("Right half of a Physical Bitcoin", "BTC"),
    item("Physical Bitcoin", "0.2BTC"),
  ];

  it("lists an item ahead of its parts and variants when both match", () => {
    expect(filterCatalog(bitcoins, "btc").map((entry) => entry.name)).toEqual([
      "Physical Bitcoin",
      "Left half of a Physical Bitcoin",
      "Right half of a Physical Bitcoin",
    ]);
    // A name inside another only counts on word boundaries.
    const rounds = [item("5.56x45mm M855A1", "M855A1"), item("5.56x45mm M855", "M855")];
    expect(filterCatalog(rounds, "m855a1").map((entry) => entry.name)).toEqual(["5.56x45mm M855A1"]);
  });

  it("matches typos only when asked and only when nothing matches exactly", () => {
    const items = [item("Graphics card", "GPU"), item("Gas analyzer", "GasAn"), item("Salewa first aid kit", "Salewa")];
    expect(filterCatalog(items, "graphics crad")).toEqual([]);
    expect(searchCatalog(items, "graphics crad", { fuzzy: true })).toMatchObject({
      fuzzy: true,
      total: 1,
      matches: [{ item: { name: "Graphics card" } }],
    });
    expect(searchCatalog(items, "salwea", { fuzzy: true }).matches[0].item.name).toBe("Salewa first aid kit");
    // Exact matches never pick up typo neighbours, and words under four letters need no typos.
    expect(searchCatalog(items, "graphics", { fuzzy: true })).toMatchObject({ fuzzy: false, total: 1 });
    expect(searchCatalog(items, "gpx", { fuzzy: true }).total).toBe(0);
    expect(filterCatalog(items, "graphics crad", [], 20, 20, { fuzzy: true })[0].name).toBe("Graphics card");
  });

  it("filters, counts every match, and suggests names that share a word", () => {
    const items = Array.from({ length: 30 }, (_, index) => item(`Injector ${index}`, null));
    const found = searchCatalog(items, "injector", { limit: 5, filter: (entry) => !entry.name.endsWith("0") });
    expect(found.total).toBe(27);
    expect(found.matches).toHaveLength(5);
    expect(listCatalog(items, (entry) => entry.name.endsWith("1")).matches.map((match) => match.item.name)).toEqual([
      "Injector 1",
      "Injector 11",
      "Injector 21",
    ]);
    expect(suggestNames([item("Graphics card", "GPU"), item("Car battery")], "graphics zzzz")).toEqual(["Graphics card"]);
    expect(suggestNames([item("Graphics card", "GPU")], "zzzzqqq")).toEqual([]);
  });
});
