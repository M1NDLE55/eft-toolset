#!/usr/bin/env node
// Writes the tarkov.dev snapshot bundled with each deployment: every dataset the adapter reads,
// for both game modes, as brotli-compressed JSON in data/tarkov, with a manifest of when each was
// fetched and its validators. A fresh instance starts from these copies instead of waiting on
// tarkov.dev, falls back to them when tarkov.dev can't be reached, and revalidates them with
// If-None-Match, so datasets that haven't changed since the build cost a 304. See
// DATA_ARCHITECTURE.md ("Deployment snapshot").
//
// It also writes each mode's compact item index (scripts/item-index.mjs), built from the items and
// items_en copies in the snapshot, so item search and name matching never parse the items file.
//
//   node scripts/build-tarkov-snapshot.mjs              fetch and write data/tarkov
//   node scripts/build-tarkov-snapshot.mjs --out dir    write elsewhere
//   node scripts/build-tarkov-snapshot.mjs --index-only rebuild only the item indexes, from the copies on disk
//
// It never fails the build: a dataset that can't be fetched keeps the copy already on disk, if any,
// and is otherwise left out (the app then waits for tarkov.dev for it, as before). An index that
// can't be built keeps the previous one, if any (the app then derives one from the items file).

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { buildItemIndex } from "./item-index.mjs";

export const MODES = ["regular", "pve"];
export const RESOURCES = [
  "items",
  "items_en",
  "tasks",
  "tasks_en",
  "traders",
  "traders_en",
  "barters",
  "crafts",
  "hideout",
  "hideout_en",
  "maps",
  "maps_en",
];
export const MANIFEST_VERSION = 1;
export const ITEM_INDEX = "item-index";

// TARKOV_UPSTREAM_URL is for local builds against a stand-in (scripts/mcp-load.mjs), as in the app.
const UPSTREAM = ((!process.env.VERCEL && process.env.TARKOV_UPSTREAM_URL) || "https://json.tarkov.dev").replace(/\/+$/, "");
const USER_AGENT = "EFT-Toolset/1.0 (+https://www.eft-toolset.com; https://github.com/M1NDLE55/eft-toolset/issues) snapshot-build";
const TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;
/** The whole snapshot gives up after this, so a hanging tarkov.dev can't hold up the build. */
const DEADLINE_MS = 120_000;
const CONCURRENCY = 4;
const MAX_BYTES = 32 * 1024 * 1024;

async function fetchResource(mode, resource, deadline) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS && !deadline.aborted; attempt++) {
    try {
      const response = await fetch(`${UPSTREAM}/${mode}/${resource}`, {
        headers: { Accept: "application/json", "Accept-Encoding": "br, gzip", "User-Agent": USER_AGENT },
        signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), deadline]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new Error("oversized payload");
      const json = JSON.parse(text);
      if (!json || typeof json !== "object" || !("data" in json)) throw new Error("no data field");
      return {
        text,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
      };
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 500 * attempt * (0.5 + Math.random())));
    }
  }
  throw lastError ?? new Error("out of time");
}

async function writeAtomic(file, contents) {
  await writeFile(`${file}.tmp`, contents);
  await rename(`${file}.tmp`, file);
}

async function readManifest(out) {
  try {
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    return manifest?.version === MANIFEST_VERSION && manifest.resources ? manifest : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} out
 * @param {Pick<Console, "info" | "warn">} [log]
 */
export async function buildSnapshot(out, log = console) {
  const previous = await readManifest(out);
  const resources = {};
  const jobs = MODES.flatMap((mode) => RESOURCES.map((resource) => ({ mode, resource })));
  let failed = 0;
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  async function run({ mode, resource }) {
    const key = `${mode}/${resource}`;
    try {
      if (deadline.aborted) throw new Error("out of time");
      const fetchedAt = Date.now();
      const { text, etag, lastModified } = await fetchResource(mode, resource, deadline);
      const raw = Buffer.from(text);
      const compressed = brotliCompressSync(raw, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
      });
      await mkdir(join(out, mode), { recursive: true });
      await writeAtomic(join(out, mode, `${resource}.json.br`), compressed);
      resources[key] = { fetchedAt, etag, lastModified, bytes: raw.length, compressedBytes: compressed.length };
    } catch (error) {
      failed += 1;
      const kept = previous?.resources?.[key];
      if (kept) resources[key] = kept;
      log.warn(`tarkov snapshot: ${key} ${kept ? "kept the previous copy" : "left out"} (${error?.message ?? error})`);
    }
  }
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) await run(queue.shift());
    })
  );
  await buildItemIndexes(out, resources, previous, log);
  const manifest = await writeManifest(out, resources, Date.now());
  const total = Object.values(resources).reduce((sum, entry) => sum + entry.compressedBytes, 0);
  const indexes = MODES.filter((mode) => resources[`${mode}/${ITEM_INDEX}`]).length;
  log.info(
    `tarkov snapshot: ${Object.keys(resources).length - indexes}/${jobs.length} datasets and ${indexes}/${MODES.length} item indexes, ${(total / 1e6).toFixed(2)} MB compressed${failed ? `, ${failed} not fetched` : ""}`
  );
  return manifest;
}

/**
 * Rebuilds only the item indexes from the snapshot already in `out`, without fetching anything.
 * @param {string} out
 * @param {Pick<Console, "info" | "warn">} [log]
 */
export async function rebuildItemIndexes(out, log = console) {
  const previous = await readManifest(out);
  if (!previous) {
    log.warn(`tarkov snapshot: no manifest in ${out}, so no item index`);
    return null;
  }
  const resources = { ...previous.resources };
  await buildItemIndexes(out, resources, previous, log);
  // The datasets are the same as before, so the snapshot keeps its build time.
  return writeManifest(out, resources, previous.builtAt);
}

/** Writes each mode's item index from its items and items_en copies in `out`, and records it in `resources`. */
async function buildItemIndexes(out, resources, previous, log) {
  for (const mode of MODES) {
    const key = `${mode}/${ITEM_INDEX}`;
    delete resources[key];
    try {
      const items = resources[`${mode}/items`];
      const translations = resources[`${mode}/items_en`];
      if (!items || !translations) throw new Error("no items copy");
      const read = async (resource) =>
        JSON.parse(brotliDecompressSync(await readFile(join(out, mode, `${resource}.json.br`))).toString("utf8")).data;
      const source = {
        items: { fetchedAt: items.fetchedAt, etag: items.etag },
        items_en: { fetchedAt: translations.fetchedAt, etag: translations.etag },
      };
      const index = buildItemIndex(await read("items"), await read("items_en"));
      const raw = Buffer.from(JSON.stringify({ ...index, source }));
      const compressed = brotliCompressSync(raw, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
      });
      await writeAtomic(join(out, mode, `${ITEM_INDEX}.json.br`), compressed);
      resources[key] = {
        // The older of its two sources, as a read of both would report.
        fetchedAt: Math.min(items.fetchedAt, translations.fetchedAt),
        bytes: raw.length,
        compressedBytes: compressed.length,
        ...source,
      };
    } catch (error) {
      const kept = previous?.resources?.[key];
      if (kept) resources[key] = kept;
      log.warn(`tarkov snapshot: ${key} ${kept ? "kept the previous copy" : "left out"} (${error?.message ?? error})`);
    }
  }
}

async function writeManifest(out, resources, builtAt) {
  const sorted = Object.fromEntries(Object.entries(resources).sort(([a], [b]) => a.localeCompare(b)));
  const manifest = { version: MANIFEST_VERSION, builtAt, resources: sorted };
  await mkdir(out, { recursive: true });
  await writeAtomic(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf("--out");
  const out = index > 0 ? process.argv[index + 1] : join(process.cwd(), "data", "tarkov");
  const build = process.argv.includes("--index-only") ? rebuildItemIndexes : buildSnapshot;
  await build(out).catch((error) => {
    console.warn(`tarkov snapshot: skipped (${error?.message ?? error})`);
  });
}
