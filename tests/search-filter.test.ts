import { describe, expect, it } from "vitest";
import { filterCatalog, MAX_SEARCH_RESULTS } from "@/app/lib/search/filter-catalog";
import type { CatalogItem } from "@/app/lib/cache/types";

function item(index: number): CatalogItem {
  return {
    id: String(index),
    name: `Test item ${index}`,
    shortName: `Item ${index}`,
    normalizedName: `test-item-${index}`,
    gridImageLink: null,
  };
}

describe("catalog search", () => {
  it("matches case-insensitively, excludes selected names, and never exceeds its result cap", () => {
    const items = Array.from({ length: 40 }, (_, index) => item(index));
    const result = filterCatalog(items, "TEST ITEM", ["Test item 0"], 1_000);

    expect(result).toHaveLength(MAX_SEARCH_RESULTS);
    expect(result[0].name).toBe("Test item 1");
    expect(result).not.toContainEqual(items[0]);
  });
});
