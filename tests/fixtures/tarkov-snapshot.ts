import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { setTarkovSnapshotDirForTests } from "@/app/lib/api/tarkov-snapshot";

export const SNAPSHOT_RESOURCES = [
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

/**
 * Writes a deployment snapshot of the fixtures for the regular mode, fetched `ageMs` ago, as
 * scripts/build-tarkov-snapshot.mjs does, and points the adapter at it. Returns its directory.
 */
export async function writeTarkovSnapshot(fixtures: Record<string, unknown>, ageMs: number) {
  const dir = await mkdtemp(join(tmpdir(), "tarkov-snapshot-"));
  await mkdir(join(dir, "regular"));
  const resources: Record<string, unknown> = {};
  for (const resource of SNAPSHOT_RESOURCES) {
    await writeFile(join(dir, "regular", `${resource}.json.br`), brotliCompressSync(JSON.stringify(fixtures[resource])));
    resources[`regular/${resource}`] = { fetchedAt: Date.now() - ageMs, etag: `"${resource}-1"` };
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ version: 1, builtAt: Date.now() - ageMs, resources }));
  setTarkovSnapshotDirForTests(dir);
  return dir;
}
