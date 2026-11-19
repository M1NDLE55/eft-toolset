// Who uploaded each quest image, for its credit line; asks the wiki's API (see DATA_ARCHITECTURE.md).
import { WIKI_ORIGIN, wikiPageUrl } from "../src/app/lib/wiki/wiki-url.ts";

export const WIKI_API = `${WIKI_ORIGIN}/api.php`;
const TITLES_PER_REQUEST = 50;
const MAX_LAG_SECONDS = 5;
const MAX_LAG_RETRIES = 3;

/** The file page of an uploaded file, given its normalised name. */
export function filePageUrl(file) {
  return wikiPageUrl(`File:${file.replace(/_/g, " ")}`);
}

/**
 * @typedef {{ file: string, hashPath: string }} ImageFile
 * @typedef {{ uploader: string | null, filePage: string, missing?: true }} ImageCredit
 * @typedef {{ name: string, url: string | null }} Licence
 * @typedef {{ fetchedAt: string | null, licence: Licence | null, images: Record<string, ImageCredit> }} CreditsFile
 * @typedef {{ fetch?: (url: string, init?: RequestInit) => Promise<Response>, userAgent?: string, delayMs?: number }} ApiOptions
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Thrown when the API can't be read, so the build keeps the credits it has. */
export class CreditsUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "CreditsUnavailable";
  }
}

async function apiGet(params, { fetch, userAgent, delayMs }) {
  const url = `${WIKI_API}?${new URLSearchParams({ ...params, format: "json", formatversion: "2", maxlag: String(MAX_LAG_SECONDS) })}`;
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "application/json" } });
    } catch (error) {
      throw new CreditsUnavailable(`GET ${WIKI_API}: ${error instanceof Error ? error.message : error}`);
    }
    const type = response.headers.get("content-type") ?? "";
    // A challenge page or any other HTML answer means the API isn't open to us right now: stop, don't retry.
    if (!type.includes("json")) throw new CreditsUnavailable(`GET ${WIKI_API}: HTTP ${response.status}, ${type || "no content type"}`);
    const body = await response.json();
    if (body.error?.code === "maxlag" && attempt < MAX_LAG_RETRIES) {
      await sleep(Math.max(delayMs, Number(response.headers.get("retry-after") ?? 5) * 1000));
      continue;
    }
    if (!response.ok || body.error) {
      throw new CreditsUnavailable(`GET ${WIKI_API}: HTTP ${response.status}${body.error ? `, ${body.error.code}` : ""}`);
    }
    return body;
  }
}

/** The images/<h>/<hh>/<Name> part of a CDN URL, decoded. */
function cdnPath(url) {
  const match = /\/images\/([0-9a-f])\/([0-9a-f]{2})\/([^/?]+)/.exec(url ?? "");
  if (!match) return null;
  let name = match[3];
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep it as written.
  }
  return { hashPath: `${match[1]}/${match[2]}`, file: name };
}

/**
 * Asks the API, fifty titles at a time and one request after another, who uploaded each image.
 * Returns each image's uploader and file page, the wiki's licence, and the images whose URL the
 * API gives differently from the one built from the file name. Throws CreditsUnavailable when
 * the API can't be read.
 */
/**
 * @param {ImageFile[]} images
 * @param {ApiOptions} [options]
 */
export async function fetchImageCredits(images, { fetch = globalThis.fetch, userAgent = "", delayMs = 1000 } = {}) {
  const options = { fetch, userAgent, delayMs };
  const site = await apiGet({ action: "query", meta: "siteinfo", siprop: "rightsinfo" }, options);
  const rights = site.query?.rightsinfo ?? {};
  const licence = rights.text ? { name: rights.text, url: rights.url ?? null } : null;

  /** @type {Record<string, ImageCredit>} */
  const credits = {};
  /** @type {{ file: string, built: string, api: string | null }[]} */
  const mismatches = [];
  /** @type {string[]} */
  const missing = [];
  const byTitle = new Map(images.map((image) => [`File:${image.file.replace(/_/g, " ")}`, image]));
  const titles = [...byTitle.keys()];
  for (let start = 0; start < titles.length; start += TITLES_PER_REQUEST) {
    await sleep(delayMs);
    const batch = titles.slice(start, start + TITLES_PER_REQUEST);
    const body = await apiGet({ action: "query", prop: "imageinfo", iiprop: "user|url", titles: batch.join("|") }, options);
    const renamed = new Map((body.query?.normalized ?? []).map((entry) => [entry.to, entry.from]));
    for (const page of body.query?.pages ?? []) {
      const asked = renamed.get(page.title) ?? page.title;
      const image = byTitle.get(asked) ?? byTitle.get(page.title);
      if (!image) continue;
      const info = page.imageinfo?.[0];
      if (page.missing || !info) {
        // The wiki has no such file: the quest page shows nothing for it.
        credits[image.file] = { uploader: null, filePage: filePageUrl(image.file), missing: true };
        missing.push(image.file);
        continue;
      }
      credits[image.file] = { uploader: info.user ?? null, filePage: filePageUrl(image.file) };
      const served = cdnPath(info.url);
      if (!served || served.hashPath !== image.hashPath || served.file !== image.file) {
        mismatches.push({ file: image.file, built: `${image.hashPath}/${image.file}`, api: info.url ?? null });
      }
    }
  }
  return { licence, credits, mismatches, missing };
}

/**
 * The credits file for the given images: fetched credits where there are some, else what the
 * existing file says, else no uploader. Images no page shows any more are dropped.
 */
/**
 * @param {ImageFile[]} images
 * @param {{ fetched?: Record<string, ImageCredit> | null, existing?: CreditsFile | null, fetchedAt?: string | null, licence?: Licence | null }} sources
 * @returns {CreditsFile}
 */
export function creditsFile(images, { fetched = null, existing = null, fetchedAt = null, licence = null }) {
  /** @type {Record<string, ImageCredit>} */
  const entries = {};
  for (const image of images.toSorted((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    entries[image.file] = fetched?.[image.file] ??
      existing?.images?.[image.file] ?? { uploader: null, filePage: filePageUrl(image.file) };
  }
  return {
    fetchedAt: fetched ? fetchedAt : (existing?.fetchedAt ?? null),
    licence: licence ?? existing?.licence ?? null,
    images: entries,
  };
}

/**
 * The credits file after one pass over the API, or, with `offline` or when the API can't be read,
 * from the existing file alone. `warnings` says what didn't go to plan.
 */
/**
 * @param {ImageFile[]} images
 * @param {ApiOptions & { existing?: CreditsFile | null, offline?: boolean, now?: () => Date }} [options]
 */
export async function updateImageCredits(images, { existing = null, offline = false, now = () => new Date(), ...options } = {}) {
  if (offline) return { file: creditsFile(images, { existing }), fetched: false, mismatches: [], missing: [], warnings: [] };
  try {
    const { licence, credits, mismatches, missing } = await fetchImageCredits(images, options);
    return {
      file: creditsFile(images, { fetched: credits, existing, fetchedAt: now().toISOString(), licence }),
      fetched: true,
      licence,
      mismatches,
      missing,
      warnings: [],
    };
  } catch (error) {
    if (!(error instanceof CreditsUnavailable)) throw error;
    return {
      file: creditsFile(images, { existing }),
      fetched: false,
      mismatches: [],
      missing: [],
      warnings: [`Image credits not fetched, kept the existing ones: ${error.message}`],
    };
  }
}
