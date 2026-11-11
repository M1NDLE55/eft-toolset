// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Checks the committed snapshot in data/wiki, which get_wiki_page serves in production.
const DIRECTORY = join(process.cwd(), "data", "wiki");
const read = (path: string) => JSON.parse(readFileSync(join(DIRECTORY, path), "utf8"));

describe("the committed wiki snapshot", () => {
  const manifest = read("manifest.json");
  const index = read("index.json");

  it("records the dump it was built from, so a newer one can be detected", () => {
    expect(manifest.source).toEqual({
      url: expect.stringMatching(/^https:\/\/.+\.xml\.7z$/),
      file: expect.stringMatching(/\.xml\.7z$/),
      bytes: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      lastModified: expect.any(String),
    });
    expect(manifest.snapshotDate).toBe(index.snapshotDate);
    expect(manifest.pages).toBe(index.pages.length);
  });

  it("has a file for every indexed page and no others", () => {
    const files = index.pages.map((entry: { file: string }) => entry.file).toSorted();
    expect(new Set(files).size).toBe(files.length);
    expect(readdirSync(join(DIRECTORY, "pages")).toSorted()).toEqual(files);
  });

  it("points every redirect at an indexed page", () => {
    const titles = new Set(index.pages.map((entry: { title: string }) => entry.title));
    for (const [from, to] of Object.entries<string>(index.redirects)) expect(titles.has(to.split("#")[0]), from).toBe(true);
  });

  it("keeps the pages players ask about", () => {
    const kinds = Object.fromEntries(index.pages.map((entry: { title: string; kind: string }) => [entry.title, entry.kind]));
    expect(kinds).toMatchObject({
      Killa: "character",
      Customs: "location",
      Insurance: "game",
      Prapor: "trader",
      "Chemical - Part 2": "quest",
    });
    expect(existsSync(join(DIRECTORY, "left-out.json"))).toBe(true);
  });
});
