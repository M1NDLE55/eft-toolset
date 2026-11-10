import type { CatalogItem } from "@/app/lib/cache/types";
import { normalizeText } from "./normalize-text";

export const MAX_SEARCH_RESULTS = 20;
/** Typo matching looks at no more words than this; a longer search must match exactly. */
const MAX_FUZZY_WORDS = 12;
/** Suggestions consider only this many distinct words of a search. */
const MAX_SUGGESTION_WORDS = 6;
/** Typo matches remembered per catalog, by search word. */
const TYPO_CACHE_SIZE = 2_000;

interface IndexedItem {
  item: CatalogItem;
  name: string;
  short: string;
  /** Ids (in the catalog's word list) of the words of the name and short name. */
  wordIds: number[];
  /** Word-aligned runs inside the name, computed on first use. */
  inner?: string[];
}

/** Each distinct word in a catalog once, for typo matching against words rather than items. */
interface WordIndex {
  words: string[];
  /** A character bitmask per word, for ruling words out before measuring edit distance. */
  masks: Uint32Array;
  /** Word ids by word length. */
  byLength: Map<number, number[]>;
  /** For each prefix length, the word ids sharing each prefix, among words long enough to be cut. */
  prefixes: Map<number, Map<string, number[]>>;
  /** Typo matches per search word: word id to distance. */
  typos: Map<string, ReadonlyMap<number, number>>;
}

interface CatalogEntries {
  entries: IndexedItem[];
  wordIndex: WordIndex;
}

export interface RankedItem {
  item: CatalogItem;
  score: number;
}

export interface CatalogSearchOptions {
  excludeNames?: readonly string[];
  /** Keeps only items this returns true for. */
  filter?: (item: CatalogItem) => boolean;
  /** When no item contains every word, match words within one or two typos instead. */
  fuzzy?: boolean;
  /** Stops ordering after this many matches; total still counts every match. */
  limit?: number;
  /**
   * Shared across the searches of one request; typo matching runs only while it lasts. A
   * search that matches nothing exactly spends one unit, which also covers suggestNames.
   */
  budget?: FuzzyBudget;
}

export interface CatalogSearch {
  /** The best matches, one per name, up to the limit. */
  matches: RankedItem[];
  /** How many names matched. */
  total: number;
  /** True when the matches came from typo matching because nothing matched exactly. */
  fuzzy: boolean;
  /** True when typo matching was skipped because the request's budget was spent. */
  skipped?: boolean;
}

const WORD = /[\p{L}\p{N}]+/gu;
const indexes = new WeakMap<readonly CatalogItem[], CatalogEntries>();

/** Normalises every item's names and lists each distinct word once. Memoised per items array. */
function indexFor(items: readonly CatalogItem[]): CatalogEntries {
  let index = indexes.get(items);
  if (!index) {
    const ids = new Map<string, number>();
    const words: string[] = [];
    const entries = items.map((item) => {
      const name = normalizeText(item.name);
      const short = item.shortName ? normalizeText(item.shortName) : "";
      const wordIds = [...new Set(`${name} ${short}`.match(WORD) ?? [])].map((word) => {
        let id = ids.get(word);
        if (id === undefined) {
          id = words.length;
          ids.set(word, id);
          words.push(word);
        }
        return id;
      });
      return { item, name, short, wordIds };
    });
    const byLength = new Map<number, number[]>();
    words.forEach((word, id) => pushTo(byLength, word.length, id));
    index = {
      entries,
      wordIndex: { words, masks: Uint32Array.from(words, charMask), byLength, prefixes: new Map(), typos: new Map() },
    };
    indexes.set(items, index);
  }
  return index;
}

function pushTo<K>(map: Map<K, number[]>, key: K, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** One bit per character class: a word missing k of another's characters is at least k edits away. */
function charMask(word: string) {
  let mask = 0;
  for (let i = 0; i < word.length; i++) mask |= 1 << (word.charCodeAt(i) % 32);
  return mask >>> 0;
}

function bitCount(value: number) {
  let count = 0;
  for (let rest = value >>> 0; rest; rest &= rest - 1) count++;
  return count;
}

/** False when the characters alone show the two words are more than max edits apart. */
function couldBeWithin(maskA: number, maskB: number, max: number) {
  return bitCount(maskA & ~maskB) <= max && bitCount(maskB & ~maskA) <= max;
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

/** Optimal string alignment distance, giving up once it exceeds max. */
function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      }
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    rows.push(row);
  }
  return rows[a.length][b.length];
}

/** Typos allowed in a word: none below four letters, one up to seven, two from eight. */
function allowedTypos(token: string) {
  return token.length < 4 || /^\d+$/.test(token) ? 0 : token.length < 8 ? 1 : 2;
}

const NO_TYPOS: ReadonlyMap<number, number> = new Map();

/** Word ids prefixLength-letter prefixes of words longer than prefixLength plus its typo allowance. */
function prefixGroups(index: WordIndex, prefixLength: number) {
  let groups = index.prefixes.get(prefixLength);
  if (!groups) {
    groups = new Map();
    const minLength = prefixLength + allowedTypos("x".repeat(prefixLength)) + 1;
    index.words.forEach((word, id) => {
      if (word.length < minLength) return;
      pushTo(groups!, word.slice(0, prefixLength), id);
    });
    index.prefixes.set(prefixLength, groups);
  }
  return groups;
}

/**
 * The catalog words within a token's typo allowance, whole or as the start of a longer word,
 * with the fewest typos for each. Computed once per catalog and token: the work depends on
 * the number of distinct catalog words of a similar length, not on the number of items.
 */
function typoWords(index: WordIndex, token: string): ReadonlyMap<number, number> {
  const max = allowedTypos(token);
  if (max === 0) return NO_TYPOS;
  const cached = index.typos.get(token);
  if (cached) {
    // Refresh its place so the cache drops the least recently used tokens first.
    index.typos.delete(token);
    index.typos.set(token, cached);
    return cached;
  }
  const found = new Map<number, number>();
  const mask = charMask(token);
  const note = (id: number, distance: number) => {
    if (distance <= max && distance < (found.get(id) ?? Infinity)) found.set(id, distance);
  };
  for (let length = token.length - max; length <= token.length + max; length++) {
    for (const id of index.byLength.get(length) ?? []) {
      if (couldBeWithin(mask, index.masks[id], max)) note(id, editDistance(token, index.words[id], max));
    }
  }
  for (const [prefix, ids] of prefixGroups(index, token.length)) {
    if (!couldBeWithin(mask, charMask(prefix), max)) continue;
    const distance = editDistance(token, prefix, max);
    if (distance <= max) for (const id of ids) note(id, distance);
  }
  const result = found.size ? found : NO_TYPOS;
  index.typos.set(token, result);
  if (index.typos.size > TYPO_CACHE_SIZE) index.typos.delete(index.typos.keys().next().value!);
  return result;
}

/** The fewest typos between an item's words and the token, or -1. */
function typosIn(entry: IndexedItem, matches: ReadonlyMap<number, number>) {
  let best = -1;
  for (const id of entry.wordIds) {
    const distance = matches.get(id);
    if (distance !== undefined && (best === -1 || distance < best)) best = distance;
  }
  return best;
}

/**
 * Items where each token appears exactly or within its typo allowance, scored. Tokens narrow
 * the candidates one at a time, so a word nothing resembles ends the search at once.
 */
function fuzzyMatches(index: CatalogEntries, entries: IndexedItem[], tokens: string[]) {
  let candidates = entries.map((entry) => ({ entry, total: 0, edits: 0 }));
  for (const token of tokens) {
    if (candidates.length === 0) break;
    let typos: ReadonlyMap<number, number> | undefined;
    candidates = candidates.filter((candidate) => {
      const { entry } = candidate;
      const inName = entry.name.indexOf(token);
      const inShort = entry.short.indexOf(token);
      if (inName !== -1 || inShort !== -1) {
        if (inName !== -1 && isWordStart(entry.name, inName)) candidate.total += 4;
        if (inShort !== -1 && isWordStart(entry.short, inShort)) candidate.total += 3;
        return true;
      }
      typos ??= typoWords(index.wordIndex, token);
      const distance = typosIn(entry, typos);
      if (distance === -1) return false;
      candidate.edits += distance;
      return true;
    });
  }
  return new Map(candidates.map((candidate) => [candidate.entry, candidate.total - 3 * candidate.edits]));
}

function prepare(search: string) {
  const needle = normalizeText(search).replace(/\s+/g, " ");
  // A repeated word adds nothing to what matches, only to the work.
  return { needle, tokens: needle ? [...new Set(needle.split(" "))] : [] };
}

type Ranked = { entry: IndexedItem; score: number };

function rank(
  entries: IndexedItem[],
  scoreOf: (entry: IndexedItem) => number | null,
  options: CatalogSearchOptions
): { matches: RankedItem[]; total: number } {
  const excluded = new Set(options.excludeNames ?? []);
  const ranked: Ranked[] = [];
  for (const entry of entries) {
    if (excluded.has(entry.item.name) || (options.filter && !options.filter(entry.item))) continue;
    const value = scoreOf(entry);
    if (value !== null) ranked.push({ entry, score: value });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.name.localeCompare(b.entry.name)
  );
  const seen = new Set<string>();
  const unique: Ranked[] = [];
  for (const match of ranked) {
    if (seen.has(match.entry.item.name)) continue;
    seen.add(match.entry.item.name);
    unique.push(match);
  }
  return { matches: basesFirst(unique, options.limit ?? Infinity), total: unique.length };
}

/**
 * Word-aligned runs of a normalised name, longest first, without the whole name:
 * "left half of a physical bitcoin" yields "physical bitcoin" among others.
 */
function innerNames(name: string) {
  const words = [...name.matchAll(WORD)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
  const runs: string[] = [];
  for (let first = 0; first < words.length; first++) {
    for (let last = words.length - 1; last >= first; last--) {
      if (first === 0 && last === words.length - 1) continue;
      runs.push(name.slice(words[first].start, words[last].end));
    }
  }
  return runs.sort((a, b) => b.length - a.length);
}

/**
 * The item a match is a variant, pack, preset, or part of: another match whose whole name
 * appears inside its name ("Left half of a Physical Bitcoin" → "Physical Bitcoin").
 */
function baseOf(entry: IndexedItem, byName: ReadonlyMap<string, Ranked>): Ranked | undefined {
  entry.inner ??= innerNames(entry.name);
  for (const run of entry.inner) {
    const base = byName.get(run);
    if (base) return base;
  }
  return undefined;
}

/** Moves an item ahead of its variants and parts when it matched too but ranked lower. */
function basesFirst(ranked: Ranked[], limit: number): RankedItem[] {
  const byName = new Map(ranked.map((match) => [match.entry.name, match]));
  const emitted = new Set<string>();
  const result: RankedItem[] = [];
  const emit = (match: Ranked) => {
    if (emitted.has(match.entry.name)) return;
    emitted.add(match.entry.name);
    result.push({ item: match.entry.item, score: match.score });
  };
  for (const match of ranked) {
    if (result.length >= limit) break;
    const base = baseOf(match.entry, byName);
    if (base) emit(base);
    emit(match);
  }
  return result.slice(0, limit);
}

/**
 * The item another item is a variant, pack, preset, or part of, among the given items: the
 * one whose whole name appears inside its name ("Left half of a Physical Bitcoin" → "Physical
 * Bitcoin"), preferring the longest such name.
 */
export function findBaseItem(item: CatalogItem, among: readonly CatalogItem[]): CatalogItem | undefined {
  return baseFinder(among)(item);
}

/** findBaseItem for many items against the same list, normalising the list once. */
export function baseFinder(among: readonly CatalogItem[]): (item: CatalogItem) => CatalogItem | undefined {
  const byName = new Map<string, Ranked>();
  for (const other of among) byName.set(normalizeText(other.name), { entry: indexEntry(other), score: 0 });
  return (item) => {
    const base = baseOf(indexEntry(item), byName)?.entry.item;
    return base && base.name !== item.name ? base : undefined;
  };
}

function indexEntry(item: CatalogItem): IndexedItem {
  const name = normalizeText(item.name);
  return { item, name, short: "", wordIds: [] };
}

/**
 * Limits how many references in one request get typo matching and suggestions, the costly
 * part of resolving a name. Once spent, names that match nothing exactly are simply not found.
 */
export class FuzzyBudget {
  constructor(private remaining: number) {}

  /** Spends one unit, or returns false when none are left. */
  take() {
    if (this.remaining <= 0) return false;
    this.remaining -= 1;
    return true;
  }
}

/**
 * Ranks every catalog item matching the search: each word must appear in the name or short
 * name. With fuzzy set and no such item, words may be one or two typos off instead.
 */
export function searchCatalog(
  items: readonly CatalogItem[],
  search: string,
  options: CatalogSearchOptions = {}
): CatalogSearch {
  const { needle, tokens } = prepare(search);
  if (!needle) return { matches: [], total: 0, fuzzy: false };
  const index = indexFor(items);
  const strict = rank(index.entries, (entry) => nonNegative(score(entry, needle, tokens)), options);
  if (strict.total > 0 || !options.fuzzy) return { ...strict, fuzzy: false };
  // An unmatched search spends a unit even when too long to match with typos, since the
  // suggestions that usually follow are paid for by the same unit.
  if (options.budget && !options.budget.take()) return { ...strict, fuzzy: false, skipped: true };
  if (tokens.length > MAX_FUZZY_WORDS) return { ...strict, fuzzy: false };
  const excluded = new Set(options.excludeNames ?? []);
  const eligible = index.entries.filter(
    (entry) => !excluded.has(entry.item.name) && (!options.filter || options.filter(entry.item))
  );
  const scores = fuzzyMatches(index, eligible, tokens);
  const fuzzy = rank([...scores.keys()], (entry) => scores.get(entry) ?? null, { ...options, filter: undefined });
  return { ...fuzzy, fuzzy: fuzzy.total > 0 };
}

function nonNegative(value: number) {
  return value < 0 ? null : value;
}

/** Every catalog item the filter keeps, in name order. */
export function listCatalog(
  items: readonly CatalogItem[],
  filter: (item: CatalogItem) => boolean,
  limit = Infinity
): CatalogSearch {
  const seen = new Set<string>();
  const kept = items
    .filter((item) => filter(item) && !seen.has(item.name) && seen.add(item.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { matches: kept.slice(0, limit).map((item) => ({ item, score: 0 })), total: kept.length, fuzzy: false };
}

/**
 * Closest names for a search that matched nothing: items matching the most of its words
 * (each exactly or within a typo), ignoring words under three letters. Only the first few
 * distinct words count, so the work stays small however long the search is.
 */
export function suggestNames(
  items: readonly CatalogItem[],
  search: string,
  limit = 5,
  budget?: FuzzyBudget
): string[] {
  const { tokens } = prepare(search);
  const useful = [...new Set(tokens.filter((token) => token.length >= 3))].slice(0, MAX_SUGGESTION_WORDS);
  if (useful.length === 0 || (budget && !budget.take())) return [];
  const index = indexFor(items);
  const matched = new Map<IndexedItem, number>();
  for (const token of useful) {
    const typos = typoWords(index.wordIndex, token);
    for (const entry of index.entries) {
      if (entry.name.includes(token) || entry.short.includes(token) || typosIn(entry, typos) !== -1) {
        matched.set(entry, (matched.get(entry) ?? 0) + 1);
      }
    }
  }
  const ranked = rank([...matched.keys()], (entry) => matched.get(entry) ?? null, { limit });
  return ranked.matches.map((match) => match.item.name);
}

export function filterCatalog(
  items: readonly CatalogItem[],
  search: string,
  excludeNames: readonly string[] = [],
  limit = MAX_SEARCH_RESULTS,
  /** Raises the cap for callers that page through results. */
  maxResults = MAX_SEARCH_RESULTS,
  options: Pick<CatalogSearchOptions, "fuzzy"> = {}
): CatalogItem[] {
  if (limit <= 0) return [];
  const boundedLimit = Number.isFinite(limit) ? Math.min(Math.floor(limit), maxResults) : maxResults;
  return searchCatalog(items, search, { excludeNames, fuzzy: options.fuzzy, limit: boundedLimit }).matches.map(
    (match) => match.item
  );
}
