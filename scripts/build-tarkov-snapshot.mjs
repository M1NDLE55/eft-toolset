#!/usr/bin/env node
// Writes the tarkov.dev snapshot bundled with each deployment: every dataset the adapter reads,
// for both game modes, as brotli-compressed JSON in data/tarkov, with a manifest of when each was
// fetched and its validators. A fresh instance starts from these copies instead of waiting on
// tarkov.dev, falls back to them when tarkov.dev can't be reached, and revalidates them with
// If-None-Match, so datasets that haven't changed since the build cost a 304. See
// DATA_ARCHITECTURE.md ("Deployment snapshot").
//
//   node scripts/build-tarkov-snapshot.mjs            fetch and write data/tarkov
//   node scripts/build-tarkov-snapshot.mjs --out dir  write elsewhere
//
// It never fails the build: a dataset that can't be fetched keeps the copy already on disk, if any,
// and is otherwise left out (the app then waits for tarkov.dev for it, as before).

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

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

const UPSTREAM = (process.env.TARKOV_UPSTREAM_URL || "https://json.tarkov.dev").replace(/\/+$/, "");
const USER_AGENT = "EFT-Toolset/1.0 (+https://www.eft-toolset.com; https://github.com/M1NDLE55/eft-toolset/issues) snapshot-build";
const TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;
const CONCURRENCY = 4;
const MAX_BYTES = 32 * 1024 * 1024;

async function fetchResource(mode, resource) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${UPSTREAM}/${mode}/${resource}`, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
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
  throw lastError;
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
  async function run({ mode, resource }) {
    const key = `${mode}/${resource}`;
    try {
      const fetchedAt = Date.now();
      const { text, etag, lastModified } = await fetchResource(mode, resource);
      const raw = Buffer.from(text);
      const compressed = brotliCompressSync(raw, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
      });
      await mkdir(join(out, mode), { recursive: true });
      const file = join(out, mode, `${resource}.json.br`);
      await writeFile(`${file}.tmp`, compressed);
      await rename(`${file}.tmp`, file);
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
  const sorted = Object.fromEntries(Object.entries(resources).sort(([a], [b]) => a.localeCompare(b)));
  const manifest = { version: MANIFEST_VERSION, builtAt: Date.now(), resources: sorted };
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const total = Object.values(resources).reduce((sum, entry) => sum + entry.compressedBytes, 0);
  log.info(
    `tarkov snapshot: ${Object.keys(resources).length}/${jobs.length} datasets, ${(total / 1e6).toFixed(2)} MB compressed${failed ? `, ${failed} not fetched` : ""}`
  );
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = process.argv.indexOf("--out");
  const out = index > 0 ? process.argv[index + 1] : join(process.cwd(), "data", "tarkov");
  await buildSnapshot(out).catch((error) => {
    console.warn(`tarkov snapshot: skipped (${error?.message ?? error})`);
  });
}
