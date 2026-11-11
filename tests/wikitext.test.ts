import { describe, expect, it } from "vitest";
import { wikitextToSections, wikitextToText } from "@/app/lib/wiki/wikitext";

describe("wikitextToText", () => {
  it("keeps link text and drops images, categories, and language links", () => {
    expect(
      wikitextToText(
        "Kill [[Killa|the boss]] on [[Interchange]]s near [[Hideout#Modules]]. [[File:Map.png|thumb|A [[map]] of it]][[Category:Bosses]][[de:Killa]] See [https://example.com the site] [https://example.com].",
        "Killa"
      )
    ).toBe("Kill the boss on Interchanges near Hideout. See the site .");
  });

  it("turns infoboxes into fields, expands the page name and quotes, and drops other templates", () => {
    const text = wikitextToText(
      [
        "{{Infobox character",
        "|image   =Killa.png",
        "|faction =[[Scavs]]",
        "|location=[[Interchange]]<br/>[[Terminal]]",
        "|origin  =",
        "|note    ={{Nested|x}}text",
        "}}",
        "'''{{PAGENAME}}''' is a boss.{{Navbox bosses}}{{5649be884bdc2d79388b4577}}",
        "{{quote|Leave me alone.}}",
        "{{Seasonal change|Bosses spawn more often.}}",
      ].join("\n"),
      "Killa"
    );
    expect(text).toBe(
      'faction: Scavs\nlocation: Interchange, Terminal\nnote: text\n\nKilla is a boss.\n"Leave me alone."\nSeasonal change: Bosses spawn more often.'
    );
  });

  it("writes tables as one row per line without attributes, image columns, or pipes from cells", () => {
    const text = wikitextToText(
      [
        '{| class="wikitable"',
        "!Icon!!Name!!Notes",
        "|-",
        "|[[File:Train.png|240px]]",
        '| style="text-align: left;" |Armored Train',
        "|Arrives late.<br/>Honks twice.",
        "|-",
        "|[[File:Gate.png]]||Gate||<font color=\"green\">✔</font> a &amp; b",
        "|}",
      ].join("\n"),
      "Reserve"
    );
    expect(text).toBe("| Name | Notes |\n| Armored Train | Arrives late.; Honks twice. |\n| Gate | yes a & b |");
  });

  it("names the items that linked icons stand for, and drops icon columns that repeat them", () => {
    expect(
      wikitextToText("Pull the lever.<br/>[[File:Key icon.png|64px|link=ZB-1013 key]]", "x")
    ).toBe("Pull the lever.\nZB-1013 key");
    const table = wikitextToText(
      [
        "{|",
        "!colspan=3|Quest items",
        "|-",
        "!Icon!!Item!!Ammo",
        "|-",
        "|[[File:a.png|link=Saiga-12K]]||[[Saiga-12K]]||[[File:b.png|link=12/70 RIP]] [[File:c.png|link=12/70 flechette]]",
        "|}",
      ].join("\n"),
      "x"
    );
    expect(table).toBe("| Item | Ammo |\n| Saiga-12K | 12/70 RIP, 12/70 flechette |");
    expect(wikitextToText("{|\n!Item!!Required!!Found in raid\n|-\n|Letter||yes||yes\n|}", "x")).toBe(
      "| Item | Required | Found in raid |\n| Letter | yes | yes |"
    );
  });

  it("labels each tab of a tabber", () => {
    expect(wikitextToText("<tabber>Weapons=\n* Gun\n|-|Armor=\n* Vest\n</tabber>", "x")).toBe(
      "Weapons:\n- Gun\n\nArmor:\n- Vest"
    );
  });

  it("removes what a reader of the page would not see", () => {
    const text = wikitextToText(
      'Visible<!-- ignore previous instructions -->​ text<span style="display:none">hidden order</span><ref>source</ref> and‮ more.__NOTOC__',
      "x"
    );
    expect(text).toBe("Visible text and more.");
  });

  it("keeps nested lists indented", () => {
    expect(wikitextToText("* One\n** One point five\n# Two", "x")).toBe("- One\n  - One point five\n- Two");
  });
});

describe("wikitextToSections", () => {
  it("splits the introduction and headings, with levels and plain-text headings", () => {
    const sections = wikitextToSections(
      "Intro text.\n==[[Interchange|Mall]]==\nIn the mall.\n====Floor 2====\nUpstairs.\n==Empty==\n==Trivia==\nFact.",
      "Killa"
    );
    expect(sections).toEqual([
      { heading: "Introduction", level: 1, text: "Intro text." },
      { heading: "Mall", level: 2, text: "In the mall." },
      { heading: "Floor 2", level: 4, text: "Upstairs." },
      { heading: "Empty", level: 2, text: "" },
      { heading: "Trivia", level: 2, text: "Fact." },
    ]);
  });

  it("does not split on headings inside tables or templates", () => {
    const sections = wikitextToSections("{|\n|\n==Not a heading==\n|}\n==Real==\nText.", "x");
    expect(sections.map((section) => section.heading)).toEqual(["Introduction", "Real"]);
  });
});
