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
/**
 * A one-word partial match resolves only when it matches this many distinct items or fewer,
 * counting variants, packs, and parts of an item as that item.
 */
const MAX_ONE_WORD_MATCHES = 1;

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
 * keycard and two flares), as is one word found inside more than one distinct item
 * ("injector", "folder"). A multi-word search tie takes the best-ranked match. With no match at all,
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

  // One word that only partly matches several distinct items ("injector", "folder") names none
  // of them, even when one ranks higher: "folder" starts one item's name, but the player may
  // mean the Intelligence folder just as well.
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
  if (sharingShortName.length > 1) {
    // Weapons and other family heads come first, then the rest of the short name's holders.
    return {
      status: "ambiguous",
      candidates: uniqueByName([...familyHeads(index, normalized), ...resolved])
        .slice(0, MAX_CANDIDATES)
        .map((item) => item.name),
    };
  }
  if (oneWord) {
    return { status: "ambiguous", candidates: resolved.slice(0, MAX_CANDIDATES).map((item) => item.name) };
  }
  return { status: "found", item: resolved[0], matchedBy, alternatives: alternativesTo(resolved[0], pool) };
}

const familyHeadNames = new WeakMap<CatalogIndex, ReadonlySet<string>>();

/**
 * Names that head a family of catalogue items: other items are named after them plus a
 * suffix (weapon presets such as "Mosin 7.62x54R bolt-action rifle (Sniper) Default", or
 * colour variants), and they are not themselves named after another item.
 */
function familyHeadSet(index: CatalogIndex): ReadonlySet<string> {
  let heads = familyHeadNames.get(index);
  if (!heads) {
    const names = [...new Set(index.items.map((item) => item.name))].sort();
    // Names extending another sort right after it, so one pass finds every family.
    const extended = new Set<string>();
    const extension = new Set<string>();
    const stack: string[] = [];
    for (const name of names) {
      while (stack.length && !name.startsWith(`${stack[stack.length - 1]} `)) stack.pop();
      if (stack.length) {
        extended.add(stack[stack.length - 1]);
        extension.add(name);
      }
      stack.push(name);
    }
    heads = new Set([...extended].filter((name) => !extension.has(name)));
    familyHeadNames.set(index, heads);
  }
  return heads;
}

const MAX_FAMILY_HEADS = 4;

/**
 * Family heads a short reference most plausibly means, best first: the short name is the
 * word, the word is a whole word of the name, or the short name is the word plus a letter or
 * two (SVDS for SVD, MP7A1 for MP7). Parts often carry a short name that is also a weapon's
 * ("Mosin" is a magazine and a pistol grip; "SVD" two magazines), and these put the weapons
 * (the Mosin rifles, the SVDS) among the candidates.
 */
function familyHeads(index: CatalogIndex, word: string): CatalogItem[] {
  const heads = familyHeadSet(index);
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wholeWord = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u");
  const rankOf = (item: CatalogItem) => {
    const short = normalizeText(item.shortName ?? "");
    if (short === word) return 0;
    if (wholeWord.test(normalizeText(item.name))) return 1;
    if (short.startsWith(word) && /^[\p{L}\p{N}]{1,2}$/u.test(short.slice(word.length))) return 2;
    return -1;
  };
  return uniqueByName(index.items.filter((item) => heads.has(item.name)))
    .map((item) => ({ item, rank: rankOf(item) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.item.name.length - b.item.name.length || a.item.name.localeCompare(b.item.name))
    .slice(0, MAX_FAMILY_HEADS)
    .map((entry) => entry.item);
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
