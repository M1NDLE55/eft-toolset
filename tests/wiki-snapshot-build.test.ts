// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildSnapshot, classify, isNewer, readDumpPages } from "../scripts/wiki-snapshot.mjs";
import { FIXTURE_SOURCE, readFixtureDump } from "./fixtures/wiki";

interface Record {
  title: string;
  url: string;
  revisionId: number;
  lastEdited: string;
  kind: string;
  categories: string[];
  redirects: string[];
  infobox: { [key: string]: string };
  sections: { heading: string; level: number; text: string }[];
}

const MARKUP = /\[\[|\]\]|\{\{|\}\}|'''|<\/?[a-z]|\{\||^\|-|__[A-Z]+__/m;

function build() {
  const { files, manifest } = buildSnapshot(readFixtureDump(), FIXTURE_SOURCE);
  const json = (path: string) => JSON.parse(files.get(path)!);
  const index = json("index.json");
  const page = (title: string): Record => {
    const entry = index.pages.find((candidate: { title: string }) => candidate.title === title);
    return json(`pages/${entry.file}`);
  };
  const section = (title: string, heading: string) => page(title).sections.find((entry) => entry.heading === heading)!.text;
  return { files, manifest, index, leftOut: json("left-out.json"), page, section };
}

describe("reading the dump", () => {
  it("keeps main-namespace pages and the section a redirect points at", () => {
    const pages = readDumpPages(readFixtureDump());
    expect(pages.map((page: { title: string }) => page.title)).not.toContain("Template:Infobox character");
    expect(pages).toHaveLength(15);
    expect(pages.find((page: { title: string }) => page.title === "Air Filtering Unit")).toMatchObject({
      redirect: "Hideout#Modules",
    });
    expect(pages.find((page: { title: string }) => page.title === "Labs")).toMatchObject({ redirect: "The Lab" });
    expect(pages.find((page: { title: string }) => page.title === "Killa")).toMatchObject({
      revisionId: 362459,
      lastEdited: "2026-09-29T15:33:26Z",
    });
  });

  it("keeps guide, behaviour, map, and mechanics pages and leaves out what tarkov.dev covers", () => {
    const kinds = Object.fromEntries(
      readDumpPages(readFixtureDump())
        .filter((page: { redirect?: string }) => !page.redirect)
        .map((page: { title: string }) => [page.title, classify(page)])
    );
    expect(kinds).toMatchObject({
      Killa: { kept: true, kind: "character" },
      Tagilla: { kept: true, kind: "character" },
      Customs: { kept: true, kind: "location" },
      Hideout: { kept: true, kind: "location" },
      "Chemical - Part 2": { kept: true, kind: "quest" },
      Insurance: { kept: true, kind: "game" },
      "Salewa first aid kit": { kept: false, kind: "item" },
      ".300 Blackout AP": { kept: false, kind: "ammo" },
      "Colt M1911A1 .45 ACP pistol": { kept: false, kind: "weapon" },
      "A Key to Salvation": { kept: false, kind: "historical" },
    });
  });
});

describe("building the snapshot", () => {
  it("turns a boss page into its infobox and plain-text sections", () => {
    const { page, section } = build();
    const killa = page("Killa");
    expect(killa).toMatchObject({
      url: "https://escapefromtarkov.fandom.com/wiki/Killa",
      revisionId: 362459,
      lastEdited: "2026-09-29T15:33:26Z",
      kind: "character",
      infobox: { faction: "Scavs", "full name": "Unknown", location: "Interchange, Terminal" },
    });
    expect(killa.categories).toContain("Bosses");
    expect(killa.sections.map((entry) => entry.heading)).toEqual(
      expect.arrayContaining(["Introduction", "Behavior", "Strategy", "Equipment", "Interchange"])
    );
    expect(killa.sections.find((entry) => entry.heading === "Interchange")?.level).toBe(4);
    expect(section("Killa", "Introduction")).toBe("Killa is a Scav Boss in Escape from Tarkov.");
    expect(section("Killa", "Strategy")).toContain("It is best to attack him with high-penetration ammunition such as 5.45 BS, 5.56 M995, or 7.62x51.");
    expect(page("Tagilla").redirects).toEqual(["Tagila"]);
  });

  it("keeps a quest's objectives and guide", () => {
    const { page, section } = build();
    expect(page("Chemical - Part 2").infobox).toMatchObject({ "given by": "Skier" });
    expect(section("Chemical - Part 2", "Objectives")).toContain("Hand over the evidence to Skier");
    expect(section("Chemical - Part 2", "Guide")).toContain(
      "They can be found in room 220 on the second floor of the three-story dorms building."
    );
  });

  it("keeps a map's extract rules as table rows, with the fee drawn as an icon", () => {
    const { section } = build();
    expect(section("Customs", "Extractions")).toContain(
      "| Dorms V-Ex | PMC | no | yes | 5000 Roubles per player; Maximum of 4 players | The fee amount is influenced by your Scav karma. |"
    );
    expect(section("Customs", "Extractions")).toContain("| Boiler Room Basement (Co-op) | All | PMC: no; Scav: yes | no | Scav + PMC |");
  });

  it("keeps a mechanics page with its subsections", () => {
    const { page, section } = build();
    expect(section("Insurance", "Introduction")).toContain("You can only insure gear items (like weapons and armors).");
    const headings = page("Insurance").sections.map((entry) => [entry.heading, entry.level]);
    expect(headings).toEqual(expect.arrayContaining([["Exceptions", 2], ["Uninsurable Items", 3]]));
  });

  it("leaves no wiki markup in any page", () => {
    const { index, page } = build();
    for (const { title } of index.pages) {
      const record = page(title);
      for (const entry of [...record.sections.map((item) => item.text), ...Object.values(record.infobox)]) {
        expect(entry, title).not.toMatch(MARKUP);
      }
    }
  });

  it("indexes kept pages and redirects, and remembers why other pages are left out", () => {
    const { index, leftOut, manifest } = build();
    expect(index.snapshotDate).toBe("2026-09-29T15:33:26Z");
    expect(index.pages.map((entry: { title: string }) => entry.title)).toEqual([
      "Chemical - Part 2",
      "Customs",
      "Hideout",
      "Insurance",
      "Killa",
      "Tagilla",
      "The Lab",
    ]);
    expect(index.redirects).toEqual({ "Air Filtering Unit": "Hideout#Modules", Labs: "The Lab", Tagila: "Tagilla" });
    expect(leftOut).toEqual({
      ".300 AP": "ammo",
      ".300 Blackout AP": "ammo",
      "A Key to Salvation": "historical",
      "Colt M1911A1 .45 ACP pistol": "weapon",
      "Salewa first aid kit": "item",
    });
    expect(manifest).toMatchObject({
      format: 1,
      source: FIXTURE_SOURCE,
      snapshotDate: "2026-09-29T15:33:26Z",
      pages: 7,
      kinds: { character: 2, game: 1, location: 3, quest: 1 },
      redirects: 3,
      leftOut: 5,
    });
  });

  it("builds the same files from the same dump", () => {
    expect([...build().files]).toEqual([...build().files]);
  });
});

describe("isNewer", () => {
  const manifest = { source: { lastModified: "Tue, 29 Sep 2026 21:24:02 GMT", bytes: 3822175 } };

  it("compares the published dump's date, or its size when either has no date", () => {
    expect(isNewer(manifest, { lastModified: "Tue, 06 Oct 2026 21:00:00 GMT", bytes: 3822175 })).toBe(true);
    expect(isNewer(manifest, { lastModified: "Tue, 29 Sep 2026 21:24:02 GMT", bytes: 3822175 })).toBe(false);
    expect(isNewer(manifest, { lastModified: null, bytes: 3900000 })).toBe(true);
    expect(isNewer(manifest, { lastModified: null, bytes: 3822175 })).toBe(false);
    expect(isNewer(null, { lastModified: null, bytes: 1 })).toBe(true);
  });
});
