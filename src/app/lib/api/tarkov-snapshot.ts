import { promisify } from "node:util";
import { brotliDecompress } from "node:zlib";
import { readDataText, platform, sharedAcrossRequests } from "@/app/lib/server/platform";

// The tarkov.dev copy bundled with the deployment by scripts/build-tarkov-snapshot.mjs. The adapter
// starts from it on a fresh instance and falls back to it when tarkov.dev can't be reached.

const decompress = promisify(brotliDecompress);
const MANIFEST_VERSION = 1;

export interface SnapshotCopy {
  value: unknown;
  /** Its size as JSON characters. */
  chars: number;
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
// "bundled" reads data/tarkov through the platform (static assets in the Worker).
let directory: string | null = process.env.VITEST ? null : "bundled";
let manifest: Promise<Manifest | null> | undefined;
let warned = false;

export function setTarkovSnapshotDirForTests(dir: string | null) {
  directory = dir;
  manifest = undefined;
}

function readManifest(): Promise<Manifest | null> {
  manifest ??= sharedAcrossRequests((async () => {
    if (!directory) return null;
    try {
      const text = await readSnapshotText(directory, "manifest.json");
      if (text === null) return null;
      const parsed = JSON.parse(text) as unknown;
      return isManifest(parsed) ? parsed : null;
    } catch {
      return null;
    }
  })());
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
    const compressed = await readSnapshotBytes(dir, `${gameMode}/${resource}.json.br`);
    if (!compressed) throw new Error(`${gameMode}/${resource}.json.br is missing.`);
    const text = (await decompress(compressed)).toString("utf8");
    const value = JSON.parse(text) as unknown;
    return { value, chars: text.length, fetchedAt: entry.fetchedAt, etag: entry.etag, lastModified: entry.lastModified };
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn("The bundled tarkov.dev snapshot couldn't be read:", error instanceof Error ? error.message : error);
    }
    return null;
  }
}

async function readSnapshotBytes(dir: string, path: string): Promise<Uint8Array | null> {
  if (dir === "bundled") return platform().readDataFile(`tarkov/${path}`);
  const [{ readFile }, { join }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  try {
    return new Uint8Array(await readFile(join(dir, path)));
  } catch {
    return null;
  }
}

async function readSnapshotText(dir: string, path: string): Promise<string | null> {
  if (dir === "bundled") return readDataText(`tarkov/${path}`);
  const bytes = await readSnapshotBytes(dir, path);
  return bytes ? new TextDecoder().decode(bytes) : null;
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
