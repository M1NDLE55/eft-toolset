// @vitest-environment node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readQuestWiki } from "@/app/lib/wiki/quest-wiki";
import { setWikiSnapshotDirectory } from "@/app/lib/wiki/snapshot";
import { dumpOf, writeFixtureSnapshot } from "./fixtures/wiki";

const CHEMICAL = { wikiLink: "https://escapefromtarkov.fandom.com/wiki/Chemical_-_Part_2", name: "Chemical - Part 2" };

describe("a quest's wiki page on the quest page", () => {
  it("keeps the guide and dialogue apart, leaving out what tarkov.dev covers", async () => {
    setWikiSnapshotDirectory(writeFixtureSnapshot());
    const wiki = await readQuestWiki(CHEMICAL);
    expect(wiki).toMatchObject({
      title: "Chemical - Part 2",
      url: "https://escapefromtarkov.fandom.com/wiki/Chemical_-_Part_2",
      snapshotDate: "2026-09-29T15:33:26Z",
    });
    expect(wiki!.guide.map((section) => section.heading)).toEqual(["Initial Equipment", "Guide"]);
    expect(wiki!.guide[1].text).toContain("Sealed letter with a TG logo");
    expect(wiki!.dialogue.map((section) => section.heading)).toEqual(["Dialogue"]);
  });

  it("finds the page by name without a usable link, and only ever a quest's page", async () => {
    setWikiSnapshotDirectory(writeFixtureSnapshot());
    expect((await readQuestWiki({ wikiLink: null, name: "Chemical - Part 2" }))?.title).toBe("Chemical - Part 2");
    expect((await readQuestWiki({ wikiLink: "https://example.com/wiki/Chemical", name: "Chemical - Part 2" }))?.title).toBe(
      "Chemical - Part 2"
    );
    expect(await readQuestWiki({ wikiLink: "https://escapefromtarkov.fandom.com/wiki/Killa", name: "Killa" })).toBeNull();
    expect(await readQuestWiki({ wikiLink: null, name: "Loyalty Buyout" })).toBeNull();
  });

  it("drops reward subsections inside the guide and keeps spawn subsections", async () => {
    const wikitext = [
      "'''Spawns''' is a [[Quests|Quest]].",
      "== Objectives ==",
      "* Find the thing",
      "== Guide ==",
      "Look in the dorms.",
      "=== First spawn ===",
      "Room 214.",
      "=== Rewards ===",
      "* 1,000 EXP",
      "== Trivia ==",
      "Named after a song.",
      "[[Category:Quests]]",
    ].join("\n");
    setWikiSnapshotDirectory(writeFixtureSnapshot(dumpOf([["Spawns", wikitext]])));
    const wiki = await readQuestWiki({ wikiLink: "https://escapefromtarkov.fandom.com/wiki/Spawns", name: "Spawns" });
    expect(wiki!.guide).toEqual([
      { heading: "Guide", text: "Look in the dorms.", subsections: [{ heading: "First spawn", text: "Room 214." }] },
      { heading: "Trivia", text: "Named after a song.", subsections: [] },
    ]);
  });

  it("joins each image with its uploader, and credits the wiki's contributors when none is known", async () => {
    const directory = writeFixtureSnapshot();
    writeFileSync(
      join(directory, "image-credits.json"),
      JSON.stringify({
        fetchedAt: "2026-11-19T00:00:00.000Z",
        images: {
          "Chemical2Map.png": { uploader: "Muhawi", filePage: "https://escapefromtarkov.fandom.com/wiki/File:Chemical2Map.png" },
          "Sliderkey_Location.png": { uploader: null, filePage: "https://escapefromtarkov.fandom.com/wiki/File:Sliderkey_Location.png" },
          "Gone.png": { uploader: null, filePage: "https://escapefromtarkov.fandom.com/wiki/File:Gone.png", missing: true },
        },
      })
    );
    setWikiSnapshotDirectory(directory);
    const wiki = await readQuestWiki(CHEMICAL);
    expect(wiki!.images).toEqual([
      {
        file: "Chemical2Map.png",
        hashPath: "b/b9",
        caption: "3 story dorms and room 220 marked on map",
        section: "Guide",
        subsection: null,
        uploader: "Muhawi",
        filePage: "https://escapefromtarkov.fandom.com/wiki/File:Chemical2Map.png",
      },
      expect.objectContaining({ file: "Sliderkey_Location.png", uploader: null }),
      expect.objectContaining({
        file: "Sealed_Letter_Location.png",
        uploader: null,
        filePage: "https://escapefromtarkov.fandom.com/wiki/File:Sealed_Letter_Location.png",
      }),
    ]);
    // The server hands over names and hash paths only; the browser builds the image URL.
    expect(JSON.stringify(wiki)).not.toContain("static.wikia.nocookie.net");
  });

  it("leaves out a file the wiki doesn't have", async () => {
    const directory = writeFixtureSnapshot();
    writeFileSync(
      join(directory, "image-credits.json"),
      JSON.stringify({
        fetchedAt: "2026-11-19T00:00:00.000Z",
        images: { "Chemical2Map.png": { uploader: null, filePage: "https://escapefromtarkov.fandom.com/wiki/File:Chemical2Map.png", missing: true } },
      })
    );
    setWikiSnapshotDirectory(directory);
    expect((await readQuestWiki(CHEMICAL))!.images.map((image) => image.file)).toEqual(["Sliderkey_Location.png", "Sealed_Letter_Location.png"]);
  });

  it("still shows images without a credits file, and none for a page without any", async () => {
    setWikiSnapshotDirectory(writeFixtureSnapshot());
    const wiki = await readQuestWiki(CHEMICAL);
    expect(wiki!.images).toHaveLength(3);
    expect(wiki!.images.every((image) => image.uploader === null)).toBe(true);
    setWikiSnapshotDirectory(writeFixtureSnapshot(dumpOf([["Spawns", "== Guide ==\nLook.\n[[Category:Quests]]"]])));
    expect((await readQuestWiki({ wikiLink: null, name: "Spawns" }))!.images).toEqual([]);
  });
});
