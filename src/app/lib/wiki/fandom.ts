import { USER_AGENT } from "@/app/lib/api/user-agent";
import { InputError } from "@/app/lib/input-error";

// Use the API to avoid HTML challenges; cache locally because API responses forbid caching.

export const WIKI_ORIGIN = "https://escapefromtarkov.fandom.com";
export const WIKI_NAME = "Escape from Tarkov Wiki";
/** As the wiki's own API states it (meta=siteinfo, rightsinfo). */
export const WIKI_LICENCE = { name: "CC BY-NC-SA", url: "https://www.fandom.com/licensing" };

const API_URL = `${WIKI_ORIGIN}/api.php`;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARS = 2_000_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const SEARCH_LIMIT = 8;
const INVALID_TITLE = /[<>[\]{}|#\u0000-\u001F\u007F]/;

/** The wiki could not be read; the message is safe to show to the caller. */
export class WikiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WikiUnavailableError";
  }
}

export interface WikiPage {
  title: string;
  url: string;
  revisionId: number;
  /** ISO time of the revision. */
  lastEdited: string;
  wikitext: string;
  /** The title asked for, when a redirect led here. */
  redirectedFrom?: string;
  /** The section a redirect points at, if any. */
  redirectFragment?: string;
}

// A type alias, so results fit the output schema's open objects.
export type WikiSearchResult = {
  title: string;
  url: string;
  lastEdited: string | null;
};

export function wikiPageUrl(title: string, fragment?: string) {
  const path = encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":");
  return `${WIKI_ORIGIN}/wiki/${path}${fragment ? `#${encodeURIComponent(fragment.replace(/ /g, "_"))}` : ""}`;
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

export function isPossibleTitle(text: string) {
  return text.length > 0 && text.length <= 255 && !INVALID_TITLE.test(text);
}

export async function fetchWikiPage(title: string, signal: AbortSignal): Promise<WikiPage | null> {
  return cached(`page:${title}`, async () => {
    const data = await callApi(
      {
        action: "query",
        prop: "revisions",
        rvprop: "content|ids|timestamp",
        rvslots: "main",
        redirects: "1",
        titles: title,
      },
      signal
    );
    const query = asRecord(data.query);
    const page = asArray(query?.pages)[0] as Record<string, unknown> | undefined;
    if (!page || page.missing || page.invalid) return null;
    const revision = asArray(page.revisions)[0] as Record<string, unknown> | undefined;
    const content = asRecord(asRecord(revision?.slots)?.main)?.content;
    if (typeof page.title !== "string" || typeof content !== "string" || typeof revision?.revid !== "number") {
      throw new WikiUnavailableError("The Escape from Tarkov Wiki returned a page this tool can't read.");
    }
    const redirect = asArray(query?.redirects)[0] as { from?: unknown; tofragment?: unknown } | undefined;
    return {
      title: page.title,
      url: wikiPageUrl(page.title),
      revisionId: revision.revid,
      lastEdited: typeof revision.timestamp === "string" ? revision.timestamp : "",
      wikitext: content,
      ...(typeof redirect?.from === "string" ? { redirectedFrom: redirect.from } : {}),
      ...(typeof redirect?.tofragment === "string" && redirect.tofragment ? { redirectFragment: redirect.tofragment } : {}),
    };
  });
}

export async function searchWiki(text: string, signal: AbortSignal): Promise<WikiSearchResult[]> {
  return cached(`search:${text.toLowerCase()}`, async () => {
    const data = await callApi(
      {
        action: "query",
        list: "search",
        srsearch: text,
        srnamespace: "0",
        srlimit: String(SEARCH_LIMIT),
        srprop: "timestamp",
      },
      signal
    );
    return asArray(asRecord(data.query)?.search).flatMap((entry) => {
      const result = entry as { title?: unknown; timestamp?: unknown };
      if (typeof result.title !== "string") return [];
      return [
        {
          title: result.title,
          url: wikiPageUrl(result.title),
          lastEdited: typeof result.timestamp === "string" ? result.timestamp : null,
        },
      ];
    });
  });
}

async function callApi(params: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const url = `${API_URL}?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`;
  let response: Response;
  let body: string;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      cache: "no-store",
    });
    body = await response.text();
  } catch (error) {
    // The tool's own deadline or cancellation is reported by the tool runner.
    if (signal.aborted) throw error;
    throw new WikiUnavailableError("The Escape from Tarkov Wiki didn't answer. Try again in a few seconds.");
  }
  if (!response.ok) {
    throw new WikiUnavailableError(`The Escape from Tarkov Wiki is unavailable right now (HTTP ${response.status}).`);
  }
  if (body.length > MAX_RESPONSE_CHARS) {
    throw new WikiUnavailableError("The Escape from Tarkov Wiki returned more than this tool reads.");
  }
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    // Cloudflare answers blocked requests with an HTML challenge page.
    throw new WikiUnavailableError("The Escape from Tarkov Wiki refused the request. Try again later.");
  }
  const record = asRecord(data);
  if (!record || record.error) {
    throw new WikiUnavailableError("The Escape from Tarkov Wiki rejected the request. Try again later.");
  }
  return record;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const CACHE_KEY = "__eftWikiCache:1";
const sharedCache = globalThis as typeof globalThis & { [CACHE_KEY]?: Map<string, CacheEntry> };
sharedCache[CACHE_KEY] ??= new Map();
const cache = sharedCache[CACHE_KEY];

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && entry.expiresAt > now) {
    cache.delete(key);
    cache.set(key, entry);
    return entry.value as T;
  }
  const value = await load();
  cache.delete(key);
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}

export function clearWikiCache() {
  cache.clear();
}
