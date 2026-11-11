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

/** A dump of the given pages, as [title, wikitext] or [title, wikitext, redirect target]. */
export function dumpOf(pages: [string, string, string?][]) {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const body = pages.map(
    ([title, wikitext, redirect], index) =>
      `<page><title>${escape(title)}</title><ns>0</ns>${redirect ? `<redirect title="${escape(redirect)}" />` : ""}` +
      `<revision><id>${index + 1}</id><timestamp>2026-09-29T00:00:00Z</timestamp><text>${escape(wikitext)}</text></revision></page>`
  );
  return `<mediawiki>${body.join("")}</mediawiki>`;
}

/** Sixteen pages copied unchanged from the 2026-09-29 dump, including redirects and left-out pages. */
export function readFixtureDump() {
  return readFileSync(new URL("./wiki/dump.xml", import.meta.url), "utf8");
}

export function writeFixtureSnapshot(xml = readFixtureDump()) {
  const directory = mkdtempSync(join(tmpdir(), "wiki-snapshot-"));
  for (const [path, json] of buildSnapshot(xml, FIXTURE_SOURCE).files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), json);
  }
  return directory;
}
