// @vitest-environment node
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
});
