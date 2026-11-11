import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSnapshot } from "../../scripts/wiki-snapshot.mjs";

export const FIXTURE_SOURCE = {
  url: "https://example.com/escapefromtarkov_gamepedia_pages_current.xml.7z",
  file: "escapefromtarkov_gamepedia_pages_current.xml.7z",
  bytes: 1,
  sha256: "0".repeat(64),
};

/** Sixteen pages copied unchanged from the 2026-09-29 dump, including redirects and left-out pages. */
export function readFixtureDump() {
  return readFileSync(new URL("./wiki/dump.xml", import.meta.url), "utf8");
}

/** Builds a snapshot of the fixture dump in a new directory and returns its path. */
export function writeFixtureSnapshot() {
  const directory = mkdtempSync(join(tmpdir(), "wiki-snapshot-"));
  for (const [path, json] of buildSnapshot(readFixtureDump(), FIXTURE_SOURCE).files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), json);
  }
  return directory;
}
