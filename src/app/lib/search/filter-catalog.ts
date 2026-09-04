import type { CatalogItem } from "@/app/lib/cache/types";

export const MAX_SEARCH_RESULTS = 20;

export function filterCatalog(
  items: readonly CatalogItem[],
  search: string,
  excludeNames: readonly string[] = [],
  limit = MAX_SEARCH_RESULTS
): CatalogItem[] {
  if (!search || limit <= 0) return [];
  const needle = search.toLocaleLowerCase();
  const excluded = new Set(excludeNames);
  const matches: CatalogItem[] = [];
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(Math.floor(limit), MAX_SEARCH_RESULTS)
    : MAX_SEARCH_RESULTS;

  for (const item of items) {
    if (!excluded.has(item.name) && item.name.toLocaleLowerCase().includes(needle)) {
      matches.push(item);
      if (matches.length === boundedLimit) break;
    }
  }
  return matches;
}
