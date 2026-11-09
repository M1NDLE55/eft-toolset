import type { CatalogEntry, CatalogItem } from "@/app/lib/cache/types";
import { filterCatalog } from "./filter-catalog";
import { normalizeText } from "./normalize-text";

export interface CatalogIndex {
  items: CatalogItem[];
  byId: Map<string, CatalogItem>;
  bySlug: Map<string, CatalogItem>;
  byName: Map<string, CatalogItem>;
  byShortName: Map<string, CatalogItem[]>;
}

export interface ResolvedItem {
  item: CatalogItem;
  matchedBy: "id" | "slug" | "name" | "shortName" | "search";
  alternatives?: string[];
}

const catalogIndexes = new WeakMap<readonly CatalogEntry[], CatalogIndex>();

/** Indexes catalog entries by id, slug, name, and short name. Memoised per entries array. */
export function indexCatalog(entries: readonly CatalogEntry[]): CatalogIndex {
  const cached = catalogIndexes.get(entries);
  if (cached) return cached;
  const items = entries.map<CatalogItem>(([id, name, shortName, , normalizedName]) => ({
    id,
    name,
    shortName,
    normalizedName,
    gridImageLink: null,
  }));
  const index: CatalogIndex = { items, byId: new Map(), bySlug: new Map(), byName: new Map(), byShortName: new Map() };
  for (const item of items) {
    index.byId.set(item.id, item);
    if (item.normalizedName) index.bySlug.set(item.normalizedName, item);
    const name = normalizeText(item.name);
    if (!index.byName.has(name)) index.byName.set(name, item);
    if (item.shortName) {
      const short = normalizeText(item.shortName);
      index.byShortName.set(short, [...(index.byShortName.get(short) ?? []), item]);
    }
  }
  catalogIndexes.set(entries, index);
  return index;
}

/**
 * Finds the item an id, slug, item page URL, name, or short name refers to, falling back to
 * the best search match (with the runners-up) when nothing matches exactly.
 */
export function resolveItemReference(index: CatalogIndex, reference: string): ResolvedItem | null {
  let value = reference.trim();
  const fromUrl = /\/item\/([^/?#]+)/.exec(value);
  if (fromUrl) {
    try {
      value = decodeURIComponent(fromUrl[1]);
    } catch {
      value = fromUrl[1];
    }
  }
  if (!value) return null;
  const byId = index.byId.get(value);
  if (byId) return { item: byId, matchedBy: "id" };
  const bySlug = index.bySlug.get(value);
  if (bySlug) return { item: bySlug, matchedBy: "slug" };
  const normalized = normalizeText(value);
  const byName = index.byName.get(normalized);
  if (byName) return { item: byName, matchedBy: "name" };
  const byShort = index.byShortName.get(normalized);
  if (byShort?.length === 1) return { item: byShort[0], matchedBy: "shortName" };
  const matches = filterCatalog(index.items, value, [], 6);
  if (matches.length === 0) return null;
  return {
    item: matches[0],
    matchedBy: "search",
    alternatives: matches.slice(1).map((match) => match.name),
  };
}
