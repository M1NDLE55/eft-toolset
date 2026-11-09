import type { CatalogItem } from "@/app/lib/cache/types";
import { normalizeText } from "./normalize-text";

export const MAX_SEARCH_RESULTS = 20;

interface IndexedItem {
  item: CatalogItem;
  name: string;
  short: string;
}

const indexes = new WeakMap<readonly CatalogItem[], IndexedItem[]>();

function indexFor(items: readonly CatalogItem[]) {
  let index = indexes.get(items);
  if (!index) {
    index = items.map((item) => ({
      item,
      name: normalizeText(item.name),
      short: item.shortName ? normalizeText(item.shortName) : "",
    }));
    indexes.set(items, index);
  }
  return index;
}

function isWordStart(haystack: string, position: number) {
  return position === 0 || !/[a-z0-9]/.test(haystack[position - 1]);
}

function score(entry: IndexedItem, needle: string, tokens: string[]) {
  let total = 0;
  for (const token of tokens) {
    const inName = entry.name.indexOf(token);
    const inShort = entry.short.indexOf(token);
    if (inName === -1 && inShort === -1) return -1;
    if (inName !== -1 && isWordStart(entry.name, inName)) total += 4;
    if (inShort !== -1 && isWordStart(entry.short, inShort)) total += 3;
  }
  if (entry.short === needle) total += 100;
  if (entry.name === needle) total += 120;
  if (entry.name.startsWith(needle)) total += 40;
  else if (entry.short.startsWith(needle)) total += 30;
  else if (entry.name.includes(needle)) total += 10;
  return total;
}

export function filterCatalog(
  items: readonly CatalogItem[],
  search: string,
  excludeNames: readonly string[] = [],
  limit = MAX_SEARCH_RESULTS,
  /** Raises the cap for callers that page through results. */
  maxResults = MAX_SEARCH_RESULTS
): CatalogItem[] {
  const needle = normalizeText(search).replace(/\s+/g, " ");
  if (!needle || limit <= 0) return [];
  const tokens = needle.split(" ");
  const excluded = new Set(excludeNames);
  const boundedLimit = Number.isFinite(limit) ? Math.min(Math.floor(limit), maxResults) : maxResults;

  const ranked: { entry: IndexedItem; score: number }[] = [];
  for (const entry of indexFor(items)) {
    if (excluded.has(entry.item.name)) continue;
    const value = score(entry, needle, tokens);
    if (value >= 0) ranked.push({ entry, score: value });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.name.localeCompare(b.entry.name)
  );

  const seen = new Set<string>();
  const results: CatalogItem[] = [];
  for (const { entry } of ranked) {
    if (seen.has(entry.item.name)) continue;
    seen.add(entry.item.name);
    results.push(entry.item);
    if (results.length === boundedLimit) break;
  }
  return results;
}
