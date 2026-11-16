// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { readItemWiki } from "@/app/lib/wiki/item-wiki";
import { setWikiSnapshotDirectory } from "@/app/lib/wiki/snapshot";
import { writeFixtureSnapshot } from "./fixtures/wiki";

const SALEWA = "544fb45d4bdc2dee738b4568";

beforeAll(() => setWikiSnapshotDirectory(writeFixtureSnapshot()));

describe("an item's wiki page on the item page", () => {
  it("splits where to find it from notes, with each map under its location", async () => {
    const wiki = await readItemWiki(SALEWA);
    expect(wiki).toMatchObject({
      title: "Salewa first aid kit",
      url: "https://escapefromtarkov.fandom.com/wiki/Salewa_first_aid_kit",
      snapshotDate: "2026-09-29T15:33:26Z",
    });
    expect(wiki!.whereToFind.map((section) => section.heading)).toEqual(["Location"]);
    expect(wiki!.whereToFind[0].subsections.map((section) => section.heading)).toEqual(
      expect.arrayContaining(["Customs", "Interchange", "Reserve", "Shoreline", "Woods"])
    );
    expect(wiki!.notes.map((section) => section.heading)).toEqual(expect.arrayContaining(["Notes", "Quest rewards"]));
  });

  it("returns nothing for an item without a page, or an id that isn't one", async () => {
    expect(await readItemWiki("0123456789abcdef01234567")).toBeNull();
    expect(await readItemWiki("../index")).toBeNull();
    expect(await readItemWiki("constructor")).toBeNull();
  });
});
