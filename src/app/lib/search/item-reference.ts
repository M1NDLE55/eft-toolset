import type { CatalogEntry, CatalogItem } from "@/app/lib/cache/types";
import { baseFinder, type FuzzyBudget, searchCatalog, suggestNames } from "./filter-catalog";
import { normalizeText } from "./normalize-text";

export interface CatalogIndex {
  items: CatalogItem[];
  byId: Map<string, CatalogItem>;
  bySlug: Map<string, CatalogItem>;
  byName: Map<string, CatalogItem>;
  byShortName: Map<string, CatalogItem[]>;
}

export type MatchKind = "id" | "slug" | "name" | "shortName" | "search" | "fuzzy";

export interface ResolvedItem {
  item: CatalogItem;
  matchedBy: MatchKind;
  alternatives?: string[];
}

/** How a reference resolved: one item, several equally likely items, or nothing. */
export type ItemMatch =
  | (ResolvedItem & {
      status: "found";
      /** Set when other items matched as well and this one was assumed. */
      assumed?: string;
    })
  | { status: "ambiguous"; candidates: string[] }
  | {
      status: "none";
      suggestions: string[];
      /** Set when typo matching was skipped because the request's budget was spent. */
      skipped?: true;
    };

export interface MatchOptions {
  /** Shared by the references of one request, to bound typo matching across all of them. */
  budget?: FuzzyBudget;
}

const MAX_ALTERNATIVES = 5;
const MAX_CANDIDATES = 8;
const SEARCH_POOL = 60;
/** A one-word partial match resolves only when it matches at most this many distinct items. */
const MAX_ONE_WORD_MATCHES = 3;

const catalogIndexes = new WeakMap<readonly CatalogEntry[], CatalogIndex>();

/** Indexes catalog entries by id, slug, name, and short name. Memoised per entries array. */
export function indexCatalog(entries: readonly CatalogEntry[]): CatalogIndex {
  const cached = catalogIndexes.get(entries);
  if (cached) return cached;
  const index = indexItems(
    entries.map<CatalogItem>(([id, name, shortName, , normalizedName]) => ({
      id,
      name,
      shortName,
      normalizedName,
      gridImageLink: null,
    }))
  );
  catalogIndexes.set(entries, index);
  return index;
}

/** Indexes items by id, slug, name, and short name, for matching against any list of items. */
export function indexItems(items: CatalogItem[]): CatalogIndex {
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
  return index;
}

function cleanReference(reference: string) {
  let value = reference.trim();
  const fromUrl = /\/item\/([^/?#]+)/.exec(value);
  if (fromUrl) {
    try {
      value = decodeURIComponent(fromUrl[1]);
    } catch {
      value = fromUrl[1];
    }
  }
  return value;
}

function exactMatch(index: CatalogIndex, value: string): ResolvedItem | null {
  const byId = index.byId.get(value);
  if (byId) return { item: byId, matchedBy: "id" };
  const bySlug = index.bySlug.get(value);
  if (bySlug) return { item: bySlug, matchedBy: "slug" };
  const byName = index.byName.get(normalizeText(value));
  if (byName) return { item: byName, matchedBy: "name" };
  return null;
}

function uniqueByName(items: readonly CatalogItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.name) && seen.add(item.name));
}

/**
 * Finds the item an id, slug, item page URL, name, or short name refers to.
 *
 * Exact ids, slugs, and names win. A short name several items share, or a search whose best
 * matches tie, resolves only when the tied items are variants, packs, presets, or parts of
 * one item that also matches ("btc" names both halves of a Physical Bitcoin, so it means the
 * Physical Bitcoin; "m855" names the round and its ammo packs). Otherwise a one-word or short
 * name reference is ambiguous and returns the candidates instead of guessing ("red" is a
 * keycard and two flares), as is one word found inside more than a few distinct items
 * ("injector"). A multi-word search tie takes the best-ranked match. With no match at all,
 * words may be a typo off ("graphics crad"), flagged as fuzzy.
 */
export function matchItemReference(index: CatalogIndex, reference: string, options: MatchOptions = {}): ItemMatch {
  const value = cleanReference(reference);
  if (!value) return { status: "none", suggestions: [] };
  const exact = exactMatch(index, value);
  if (exact) return { status: "found", ...exact };

  const normalized = normalizeText(value).replace(/\s+/g, " ");
  const sharingShortName = uniqueByName(index.byShortName.get(normalized) ?? []);
  if (sharingShortName.length === 1) return { status: "found", item: sharingShortName[0], matchedBy: "shortName" };

  const search = searchCatalog(index.items, value, { fuzzy: true, limit: SEARCH_POOL, budget: options.budget });
  if (search.matches.length === 0) {
    if (search.skipped) return { status: "none", suggestions: [], skipped: true };
    return { status: "none", suggestions: suggestNames(index.items, value) };
  }
  const pool = search.matches.map((match) => match.item);
  const baseIn = baseFinder(pool);
  const matchedBy = search.fuzzy ? "fuzzy" : "search";

  // The items with the best claim: every item sharing the short name, or the top-scoring tie.
  const contenders =
    sharingShortName.length > 1
      ? sharingShortName
      : search.matches.filter((match) => match.score === search.matches[0].score).map((match) => match.item);
  const resolved = uniqueByName(contenders.map((item) => baseIn(item) ?? item));
  const oneWord = !normalized.includes(" ");

  // One word that only partly matches many distinct items ("injector", "folder") names none of them.
  if (oneWord && sharingShortName.length === 0) {
    const distinct = uniqueByName(pool.map((item) => baseIn(item) ?? item));
    if (distinct.length > MAX_ONE_WORD_MATCHES) {
      return { status: "ambiguous", candidates: distinct.slice(0, MAX_CANDIDATES).map((item) => item.name) };
    }
  }

  if (resolved.length === 1) {
    const [item] = resolved;
    const others = contenders.filter((contender) => contender.name !== item.name).map((contender) => contender.name);
    return {
      status: "found",
      item,
      matchedBy: normalizeText(item.shortName ?? "") === normalized ? "shortName" : matchedBy,
      alternatives: alternativesTo(item, pool),
      ...(others.length
        ? { assumed: `"${value}" also matches ${others.join(", ")}; chose ${item.name}, which they are variants or parts of.` }
        : {}),
    };
  }
  if (sharingShortName.length > 1 || oneWord) {
    return { status: "ambiguous", candidates: resolved.slice(0, MAX_CANDIDATES).map((item) => item.name) };
  }
  return { status: "found", item: resolved[0], matchedBy, alternatives: alternativesTo(resolved[0], pool) };
}

function alternativesTo(item: CatalogItem, pool: readonly CatalogItem[]) {
  return pool
    .filter((other) => other.name !== item.name)
    .slice(0, MAX_ALTERNATIVES)
    .map((other) => other.name);
}

/**
 * The single item a reference most likely means, or null. Ambiguous references return the
 * first candidate as a search match; use matchItemReference to tell them apart.
 */
export function resolveItemReference(index: CatalogIndex, reference: string): ResolvedItem | null {
  const match = matchItemReference(index, reference);
  if (match.status === "none") return null;
  if (match.status === "ambiguous") {
    const [first, ...rest] = match.candidates;
    const item = index.byName.get(normalizeText(first));
    return item ? { item, matchedBy: "search", alternatives: rest } : null;
  }
  return { item: match.item, matchedBy: match.matchedBy, ...(match.alternatives ? { alternatives: match.alternatives } : {}) };
}
