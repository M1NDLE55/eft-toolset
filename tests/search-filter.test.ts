import { describe, expect, it } from "vitest";
import { filterCatalog, MAX_SEARCH_RESULTS } from "@/app/lib/search/filter-catalog";
import type { CatalogItem } from "@/app/lib/cache/types";

function item(name: string, shortName: string | null = null, id = name): CatalogItem {
  return { id, name, shortName, gridImageLink: null };
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
