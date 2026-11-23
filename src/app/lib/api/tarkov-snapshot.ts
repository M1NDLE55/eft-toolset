import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliDecompress } from "node:zlib";

// The tarkov.dev copy bundled with the deployment by scripts/build-tarkov-snapshot.mjs. The adapter
// starts from it on a fresh instance and falls back to it when tarkov.dev can't be reached.

const decompress = promisify(brotliDecompress);
const MANIFEST_VERSION = 1;

export interface SnapshotCopy {
  value: unknown;
  /** When the build fetched it from tarkov.dev. */
  fetchedAt: number;
  etag?: string;
  lastModified?: string;
}

interface ManifestEntry {
  fetchedAt: number;
  etag?: string;
  lastModified?: string;
}

interface Manifest {
  builtAt: number;
  resources: Record<string, ManifestEntry>;
}

// Tests opt in with setTarkovSnapshotDirForTests, so a local build's snapshot never leaks into them.
let directory: string | null = process.env.VITEST ? null : join(process.cwd(), "data", "tarkov");
let manifest: Promise<Manifest | null> | undefined;
let warned = false;

export function setTarkovSnapshotDirForTests(dir: string | null) {
  directory = dir;
  manifest = undefined;
}

function readManifest(): Promise<Manifest | null> {
  manifest ??= (async () => {
    if (!directory) return null;
    try {
      const parsed = JSON.parse(
        await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ directory, "manifest.json"), "utf8")
      ) as unknown;
      return isManifest(parsed) ? parsed : null;
    } catch {
      return null;
    }
  })();
  return manifest;
}

/** When the bundled snapshot was built, or null without one. Reads only the manifest. */
export async function snapshotBuiltAt(): Promise<number | null> {
  return (await readManifest())?.builtAt ?? null;
}

/** The bundled copy of one dataset, or null when the deployment has none or it can't be read. */
export async function readSnapshot(gameMode: string, resource: string): Promise<SnapshotCopy | null> {
  const dir = directory;
  const entry = (await readManifest())?.resources[`${gameMode}/${resource}`];
  if (!dir || !entry) return null;
  try {
    const compressed = await readFile(
      /*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, gameMode, `${resource}.json.br`)
    );
    const value = JSON.parse((await decompress(compressed)).toString("utf8")) as unknown;
    return { value, fetchedAt: entry.fetchedAt, etag: entry.etag, lastModified: entry.lastModified };
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn("The bundled tarkov.dev snapshot couldn't be read:", error instanceof Error ? error.message : error);
    }
    return null;
  }
}

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== MANIFEST_VERSION || typeof record.builtAt !== "number") return false;
  const resources = record.resources;
  if (typeof resources !== "object" || resources === null) return false;
  return Object.values(resources).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as ManifestEntry).fetchedAt === "number" &&
      Number.isFinite((entry as ManifestEntry).fetchedAt)
  );
}
