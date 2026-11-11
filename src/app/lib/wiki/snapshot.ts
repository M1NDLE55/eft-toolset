import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InputError } from "@/app/lib/input-error";
import { WIKI_ORIGIN, wikiPageUrl } from "./wiki-url";
import type { WikiSection } from "./wikitext";

// Reads the wiki snapshot in data/wiki, built by scripts/build-wiki-snapshot.mjs from the
// wiki's published XML dump. Nothing here contacts the wiki.

/** One wiki page as plain text, as stored in data/wiki/pages. */
export interface WikiPageRecord {
  title: string;
  url: string;
  revisionId: number;
  /** ISO time of the revision in the dump. */
  lastEdited: string;
  kind: string;
  categories: string[];
  /** Titles that redirect here. */
  redirects: string[];
  infobox: Record<string, string>;
  sections: WikiSection[];
}

interface IndexEntry {
  title: string;
  file: string;
  kind: string;
  lastEdited: string;
}

interface SnapshotIndex {
  snapshotDate: string;
  pages: IndexEntry[];
  /** Redirect title to target, which may end in "#Section". */
  redirects: Record<string, string>;
}

interface LoadedIndex extends SnapshotIndex {
  byTitle: Map<string, IndexEntry>;
  byNormalized: Map<string, string[]>;
}

export interface FoundPage {
  page: WikiPageRecord;
  matchedBy: "title" | "search";
  /** The title asked for, when a redirect led here. */
  redirectedFrom?: string;
  /** The section a redirect points at, if any. */
  redirectFragment?: string;
}

export type WikiSearchResult = { title: string; url: string; lastEdited: string | null };

const MAX_CACHED_PAGES = 100;
const SEARCH_LIMIT = 8;
const INVALID_TITLE = /[<>[\]{}|#\u0000-\u001F\u007F]/;

let directory = join(process.cwd(), "data", "wiki");
let index: Promise<LoadedIndex> | null = null;
let leftOut: Promise<{ title: string; kind: string; key: string }[]> | null = null;
const pages = new Map<string, Promise<WikiPageRecord>>();

/** Points the reader at another snapshot directory; for tests. */
export function setWikiSnapshotDirectory(path: string) {
  directory = path;
  index = null;
  leftOut = null;
  pages.clear();
}

async function readJson<T>(path: string): Promise<T> {
  // next.config.mjs traces data/wiki into the function, so the build needn't follow this path.
  return JSON.parse(await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ directory, path), "utf8")) as T;
}

function loadIndex() {
  if (index) return index;
  index = readJson<SnapshotIndex>("index.json").then((loaded) => {
    const byNormalized = new Map<string, string[]>();
    const add = (title: string) => {
      const key = normalize(title);
      byNormalized.set(key, [...(byNormalized.get(key) ?? []), title]);
    };
    for (const entry of loaded.pages) add(entry.title);
    for (const title of Object.keys(loaded.redirects)) add(title);
    return { ...loaded, byTitle: new Map(loaded.pages.map((entry) => [entry.title, entry])), byNormalized };
  });
  index.catch(() => (index = null));
  return index;
}

function readPage(entry: IndexEntry) {
  let page = pages.get(entry.file);
  if (page) {
    pages.delete(entry.file);
  } else {
    page = readJson<WikiPageRecord>(`pages/${entry.file}`);
    page.catch(() => pages.delete(entry.file));
  }
  pages.set(entry.file, page);
  while (pages.size > MAX_CACHED_PAGES) pages.delete(pages.keys().next().value!);
  return page;
}

/** The time of the latest edit in the dump the snapshot was built from. */
export async function wikiSnapshotDate() {
  return (await loadIndex()).snapshotDate;
}

/** Ignores case, spaces, and punctuation, so "chemical part 2" finds "Chemical - Part 2". */
export function normalize(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** MediaWiki titles: underscores are spaces and the first letter is case-insensitive. */
function canonical(title: string) {
  const spaced = title.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Finds a page by title, redirect, or a title differing only in case and punctuation. */
export async function findWikiPage(title: string): Promise<FoundPage | null> {
  const loaded = await loadIndex();
  let wanted = canonical(title);
  let matchedBy: FoundPage["matchedBy"] = "title";
  if (!loaded.byTitle.has(wanted) && !loaded.redirects[wanted]) {
    const near = loaded.byNormalized.get(normalize(title)) ?? [];
    if (near.length !== 1) return null;
    wanted = near[0];
    matchedBy = "search";
  }
  const entry = loaded.byTitle.get(wanted);
  if (entry) return { page: await readPage(entry), matchedBy };
  const target = loaded.redirects[wanted];
  const at = target.indexOf("#");
  const targetEntry = loaded.byTitle.get(at < 0 ? target : target.slice(0, at));
  if (!targetEntry) return null;
  return {
    page: await readPage(targetEntry),
    matchedBy,
    redirectedFrom: wanted,
    ...(at >= 0 && target.slice(at + 1) ? { redirectFragment: target.slice(at + 1) } : {}),
  };
}

/** Titles that share the most words with the text, best first. */
export async function searchWiki(text: string): Promise<WikiSearchResult[]> {
  const loaded = await loadIndex();
  const query = normalize(text);
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  if (!query) return [];
  const scores = new Map<string, number>();
  const score = (title: string, target: string) => {
    const name = normalize(title);
    const titleWords = title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
    let points = words.filter((word) => titleWords.some((titleWord) => titleWord.startsWith(word))).length;
    if (name.includes(query)) points += words.length + 1;
    if (points > 0 && points > (scores.get(target) ?? 0)) scores.set(target, points - name.length / 1_000);
  };
  for (const entry of loaded.pages) score(entry.title, entry.title);
  for (const [title, target] of Object.entries(loaded.redirects)) score(title, target.split("#")[0]);
  return [...scores]
    .filter(([title]) => loaded.byTitle.has(title))
    .toSorted(([titleA, a], [titleB, b]) => b - a || titleA.localeCompare(titleB))
    .slice(0, SEARCH_LIMIT)
    .map(([title]) => ({ title, url: wikiPageUrl(title), lastEdited: loaded.byTitle.get(title)!.lastEdited }));
}

/**
 * A page the snapshot leaves out on purpose, with why (such as "item"): the page titled so, or
 * else the shortest left-out title containing the text, ignoring case and punctuation.
 */
export async function findLeftOutPage(text: string): Promise<{ title: string; kind: string } | null> {
  if (!leftOut) {
    leftOut = readJson<Record<string, string>>("left-out.json").then((titles) =>
      Object.entries(titles).map(([title, kind]) => ({ title, kind, key: normalize(title) }))
    );
    leftOut.catch(() => (leftOut = null));
  }
  const titles = await leftOut;
  const wanted = canonical(text);
  const query = normalize(text);
  const exact = titles.find((entry) => entry.title === wanted);
  if (exact || query.length < 3) return exact ? { title: exact.title, kind: exact.kind } : null;
  let best: (typeof titles)[number] | null = null;
  for (const entry of titles) {
    if (entry.key.includes(query) && (!best || entry.title.length < best.title.length)) best = entry;
  }
  return best ? { title: best.title, kind: best.kind } : null;
}

export function isPossibleTitle(text: string) {
  return text.length > 0 && text.length <= 255 && !INVALID_TITLE.test(text);
}

export function parseWikiLink(input: string): { title: string; fragment?: string } | null {
  const trimmed = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new WikiLinkError();
  }
  if (url.hostname !== new URL(WIKI_ORIGIN).hostname || !url.pathname.startsWith("/wiki/")) throw new WikiLinkError();
  const title = decodePart(url.pathname.slice("/wiki/".length));
  const fragment = url.hash ? decodePart(url.hash.slice(1)) : undefined;
  if (!title) throw new WikiLinkError();
  return { title, fragment: fragment || undefined };
}

export class WikiLinkError extends InputError {
  constructor() {
    super(`Only ${WIKI_ORIGIN}/wiki/ pages can be read. Pass a page title or search text instead.`);
    this.name = "WikiLinkError";
  }
}

function decodePart(part: string) {
  try {
    return decodeURIComponent(part).replace(/_/g, " ").trim();
  } catch {
    return part.replace(/_/g, " ").trim();
  }
}
