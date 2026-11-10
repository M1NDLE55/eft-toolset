import type { CatalogItem } from "@/app/lib/cache/types";
import { normalizeText } from "./normalize-text";

export const MAX_SEARCH_RESULTS = 20;

interface IndexedItem {
  item: CatalogItem;
  name: string;
  short: string;
  /** Words of the name and short name, for typo matching. */
  words: string[];
  /** Word-aligned runs inside the name, computed on first use. */
  inner?: string[];
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
}

export interface CatalogSearch {
  /** The best matches, one per name, up to the limit. */
  matches: RankedItem[];
  /** How many names matched. */
  total: number;
  /** True when the matches came from typo matching because nothing matched exactly. */
  fuzzy: boolean;
}

const WORD = /[\p{L}\p{N}]+/gu;
const indexes = new WeakMap<readonly CatalogItem[], IndexedItem[]>();

function indexFor(items: readonly CatalogItem[]) {
  let index = indexes.get(items);
  if (!index) {
    index = items.map((item) => {
      const name = normalizeText(item.name);
      const short = item.shortName ? normalizeText(item.shortName) : "";
      return { item, name, short, words: [...new Set(`${name} ${short}`.match(WORD) ?? [])] };
    });
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

/** The fewest typos between token and a word (or the start of a longer word), or -1. */
function typos(entry: IndexedItem, token: string) {
  const max = allowedTypos(token);
  if (max === 0) return -1;
  let best = max + 1;
  for (const word of entry.words) {
    best = Math.min(best, editDistance(token, word, max));
    if (word.length > token.length + max) best = Math.min(best, editDistance(token, word.slice(0, token.length), max));
    if (best === 1) break;
  }
  return best > max ? -1 : best;
}

/** Scores a match that allows typos: each word must appear exactly or within its typo allowance. */
function fuzzyScore(entry: IndexedItem, tokens: string[]): number | null {
  let total = 0;
  let edits = 0;
  for (const token of tokens) {
    const inName = entry.name.indexOf(token);
    const inShort = entry.short.indexOf(token);
    if (inName !== -1 || inShort !== -1) {
      if (inName !== -1 && isWordStart(entry.name, inName)) total += 4;
      if (inShort !== -1 && isWordStart(entry.short, inShort)) total += 3;
      continue;
    }
    const distance = typos(entry, token);
    if (distance === -1) return null;
    edits += distance;
  }
  return total - 3 * edits;
}

function prepare(search: string) {
  const needle = normalizeText(search).replace(/\s+/g, " ");
  return { needle, tokens: needle ? needle.split(" ") : [] };
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
  const byName = new Map<string, Ranked>();
  for (const other of among) {
    if (other.name !== item.name) byName.set(normalizeText(other.name), { entry: indexEntry(other), score: 0 });
  }
  return baseOf(indexEntry(item), byName)?.entry.item;
}

function indexEntry(item: CatalogItem): IndexedItem {
  const name = normalizeText(item.name);
  return { item, name, short: "", words: [] };
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
  const entries = indexFor(items);
  const strict = rank(entries, (entry) => nonNegative(score(entry, needle, tokens)), options);
  if (strict.total > 0 || !options.fuzzy) return { ...strict, fuzzy: false };
  const fuzzy = rank(entries, (entry) => fuzzyScore(entry, tokens), options);
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
 * (each exactly or within a typo), ignoring words under three letters.
 */
export function suggestNames(items: readonly CatalogItem[], search: string, limit = 5): string[] {
  const { tokens } = prepare(search);
  const useful = tokens.filter((token) => token.length >= 3);
  if (useful.length === 0) return [];
  const ranked = rank(
    indexFor(items),
    (entry) => {
      let matched = 0;
      for (const token of useful) {
        if (entry.name.includes(token) || entry.short.includes(token) || typos(entry, token) !== -1) matched += 1;
      }
      return matched === 0 ? null : matched;
    },
    { limit }
  );
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
