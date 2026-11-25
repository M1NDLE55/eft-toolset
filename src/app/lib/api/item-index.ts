import type { CatalogEntry } from "@/app/lib/cache/types";
import { sharedAcrossRequests } from "@/app/lib/server/platform";
import { buildItemIndex, isItemIndex, type IndexCategory, type ItemIndex } from "../../../../scripts/item-index.mjs";
import type { ItemFacet, ItemFacets } from "./tarkov-server";
import { readSnapshot } from "./tarkov-snapshot";

// Item search, name matching and category filters read the compact item index rather than the
// 17 MB items file: the copy bundled with the deployment, or one derived from a newer items copy
// this instance already holds. See scripts/item-index.mjs and DATA_ARCHITECTURE.md.

export interface ExpandedItemIndex {
  catalog: CatalogEntry[];
  facets: ItemFacets;
}

/** A copy of a dataset as the adapter holds it: the parsed file, when it was confirmed, and its ETag. */
export interface DatasetCopy {
  value: { data: unknown };
  fetchedAt: number;
  etag?: string;
}

export interface ItemCopies {
  items: DatasetCopy;
  translations: DatasetCopy;
}

export interface ItemIndexRead {
  index: ExpandedItemIndex;
  /** When the items and items_en copies it was built from were last confirmed current. */
  fetchedAt: number;
  source: "deployment" | "tarkov.dev";
}

interface SourceStamp {
  fetchedAt: number;
  etag?: string;
}

interface BundledIndex {
  index: ExpandedItemIndex;
  fetchedAt: number;
  items: SourceStamp;
  translations: SourceStamp;
}

interface IndexState {
  bundled: Map<string, Promise<BundledIndex | null>>;
  derived: Map<string, { items: unknown; translations: unknown; index: ExpandedItemIndex }>;
}

// Shared through globalThis, like the adapter's resource cache, so every server chunk reads the
// bundled index once per instance.
const STATE_KEY = "__eftItemIndex:1";
const shared = globalThis as typeof globalThis & { [STATE_KEY]?: IndexState };
shared[STATE_KEY] ??= { bundled: new Map(), derived: new Map() };
const state = shared[STATE_KEY];

/**
 * The item index to serve, given the items and items_en copies this instance holds (if any): one
 * derived from those copies when either is newer than what the bundled index was built from,
 * otherwise the bundled index. Null when the deployment has no index, so the caller loads the items
 * file as before.
 */
export async function loadItemIndex(gameMode: string, copies: ItemCopies | null): Promise<ItemIndexRead | null> {
  const bundled = await readBundledIndex(gameMode);
  if (!bundled) return null;
  if (!copies) return { index: bundled.index, fetchedAt: bundled.fetchedAt, source: "deployment" };
  const pairs = [
    [copies.items, bundled.items],
    [copies.translations, bundled.translations],
  ] as const;
  const same = pairs.every(([copy, built]) => copy.etag !== undefined && copy.etag === built.etag);
  if (same) {
    // The same files, confirmed since the build.
    const confirmedAt = Math.min(copies.items.fetchedAt, copies.translations.fetchedAt);
    return { index: bundled.index, fetchedAt: Math.max(bundled.fetchedAt, confirmedAt), source: "deployment" };
  }
  const newer = pairs.some(
    ([copy, built]) => (copy.etag === undefined || copy.etag !== built.etag) && copy.fetchedAt > built.fetchedAt
  );
  if (!newer) return { index: bundled.index, fetchedAt: bundled.fetchedAt, source: "deployment" };
  return {
    index: deriveItemIndex(gameMode, copies.items.value, copies.translations.value),
    fetchedAt: Math.min(copies.items.fetchedAt, copies.translations.fetchedAt),
    source: "tarkov.dev",
  };
}

/** The index of these items and items_en files, built once per pair of copies. */
export function deriveItemIndex(
  gameMode: string,
  items: { data: unknown },
  translations: { data: unknown }
): ExpandedItemIndex {
  const cached = state.derived.get(gameMode);
  if (cached && cached.items === items && cached.translations === translations) return cached.index;
  const index = expandItemIndex(buildItemIndex(items.data, translations.data as Record<string, string>));
  state.derived.set(gameMode, { items, translations, index });
  return index;
}

/** Forgets one mode's derived index, which holds on to the items copy it came from (the memory guard). */
export function forgetDerivedItemIndex(gameMode: string) {
  state.derived.delete(gameMode);
}

/** Forgets the bundled and derived indexes. For tests, with clearTarkovResourceCache. */
export function clearItemIndexCache() {
  state.bundled.clear();
  state.derived.clear();
}

function readBundledIndex(gameMode: string): Promise<BundledIndex | null> {
  let bundled = state.bundled.get(gameMode);
  if (!bundled) {
    bundled = sharedAcrossRequests(readSnapshot(gameMode, "item-index").then((copy) => {
      const value = copy?.value as (ItemIndex & { source?: { items?: SourceStamp; items_en?: SourceStamp } }) | undefined;
      if (!copy || !isItemIndex(value) || !value.source?.items || !value.source.items_en) return null;
      return {
        index: expandItemIndex(value),
        fetchedAt: copy.fetchedAt,
        items: value.source.items,
        translations: value.source.items_en,
      };
    }));
    state.bundled.set(gameMode, bundled);
  }
  return bundled;
}

/** The catalog and facets the adapter served from the items file, from the compact index. */
export function expandItemIndex(index: ItemIndex): ExpandedItemIndex {
  const handbookLabels = categoryLabels(index.handbook);
  const itemLabels = categoryLabels(index.categories);
  const catalog: CatalogEntry[] = [];
  const byId = new Map<string, ItemFacet>();
  for (const [id, name, shortName, image, normalizedName, types, handbook, categories, caliber] of index.items) {
    if (name) catalog.push([id, name, shortName, image, normalizedName]);
    byId.set(id, {
      types: types.map((type) => index.types[type]),
      categories: [
        ...new Set([
          ...handbook.flatMap((category) => handbookLabels[category]),
          ...categories.flatMap((category) => itemLabels[category]),
        ]),
      ],
      caliber: caliber < 0 ? null : index.calibers[caliber],
    });
  }
  const names = (rows: IndexCategory[]) => Array.from(new Set(rows.map(([name]) => name))).filter(Boolean);
  return {
    catalog,
    facets: { byId, categoryNames: names(index.handbook), itemCategoryNames: names(index.categories) },
  };
}

/** Each category's lower-case name and slug, followed by its parents'. */
function categoryLabels(rows: IndexCategory[]): string[][] {
  return rows.map((_, start) => {
    const labels: string[] = [];
    const seen = new Set<number>();
    for (let current = start; current >= 0 && !seen.has(current); current = rows[current][2]) {
      seen.add(current);
      const [name, normalizedName] = rows[current];
      const lower = name.toLocaleLowerCase();
      if (lower) labels.push(lower);
      if (normalizedName) labels.push(normalizedName);
    }
    return labels;
  });
}
