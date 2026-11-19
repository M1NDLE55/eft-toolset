// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashPath, normaliseFileName, questImages, surveyImages } from "../scripts/wiki-images.mjs";

// Shaped like the quest pages in the dump: an infobox banner, an icon table, packed galleries, inline files.
const DELIVERY = [
  "{{Infobox quest",
  "|image           =Delivery From the Past Banner.png",
  "|given by        =[[Prapor]]",
  "}}",
  "'''{{PAGENAME}}''' is a [[Quests|Quest]] in ''[[Escape from Tarkov]]''.",
  "==Objectives==",
  "* Locate and obtain the [[Secure Folder 0022|valuable folder]] on [[Customs]]",
  "==Rewards==",
  "* +2 pocket slots",
  ":[[File:Old Patterns Pockets Upgrade.png]]",
  '<li style="display: inline-block;"><gallery widths="127" heights="127" mode="packed">',
  "File:KillaHelmet with FS.png|Maska-1SCh (Killa Edition) with face shield",
  "</gallery></li>",
  "==Guide==",
  '{| class="wikitable"',
  "! colspan=\"6\" |Related Quest Items",
  "|-",
  "|[[File:Customs-office-key-Icon.png|link=Tarcone Director's office key]]",
  "|[[Tarcone Director's office key]]",
  "|-",
  "|[[File:Car Battery Icon.png|frameless|190px|link=Car battery]]",
  "|[[Car battery]]",
  "|}",
  "Head to the red warehouse on [[Customs]].",
  '<li style="display: inline-block;"><gallery widths="300" heights="169" mode="packed">',
  "File:Delivery from the past Customs.png|Warehouse marked on map",
  "File:CustomsOffice.png|The office",
  "Image:Docs 0022-Delivery From the Past.png|Docs 0022 is under the [[desk]], on top of the ''drawers''",
  "File:Delivery from the past Customs.png|Warehouse marked on map again",
  "</gallery></li>",
  "===First spawn===",
  "<gallery>",
  "Chem1West2.png",
  "File:Chem1West.png|alt=The west room",
  "</gallery>",
  "Upon entering the area, a notification pops up: [[File:KlimovStreetSignalAreaNote.png]]",
  "[[File:Gunsmithpart1Modding.png|800px|link={{filepath:Gunsmithpart1Modding.png}}]]",
  "[[File:Weightfatigue.12.4.png|46px|Fatigue]]",
  "[[File:Savior icon.png|Savior ending|74x74px|link=]]",
  "[[File:Therapist Portrait.png|105x105px|link=|class=wds-tabs__tab-label|Therapist]]",
  "[[File:The Ticket Flowchart by Callsign Smokey.png|thumb|right|300px|Endings flowchart]]",
  "<!-- [[File:Hidden map.png|Hidden]] -->",
  "See [[:File:Linked only.png]] and [[Media:Direct.png]].",
  "==Trivia==",
  "[[File:Gaming magazine reference.png|250px]]",
  "{{Navbox quests}}",
  "[[Category:Quests]]",
].join("\n");

describe("file names and hash paths", () => {
  it("normalises names as MediaWiki stores them", () => {
    expect(normaliseFileName("File:Delivery from the past Customs.png")).toBe("Delivery_from_the_past_Customs.png");
    expect(normaliseFileName(" Image : chem1West.png ")).toBe("Chem1West.png");
    expect(normaliseFileName("File: a  b__c .png")).toBe("A_b_c_.png");
    expect(normaliseFileName("Pevko_beer_icon.png")).toBe("Pevko_beer_icon.png");
    expect(normaliseFileName("File:Tom &amp; Jerry.png")).toBe("Tom_&_Jerry.png");
  });

  it("keeps files under the first one and two hex digits of the name's md5", () => {
    expect(hashPath("Delivery_from_the_past_Customs.png")).toBe("4/4a");
    expect(hashPath("File:Delivery from the past Customs.png")).toBe("4/4a");
    expect(hashPath("Chem1West.png")).toBe("5/50");
  });
});

describe("a quest page's images", () => {
  it("keeps map, location and in-raid pictures with their caption and section", () => {
    expect(questImages(DELIVERY, "Delivery From the Past")).toEqual([
      { file: "Delivery_from_the_past_Customs.png", hashPath: "4/4a", caption: "Warehouse marked on map", section: "Guide", subsection: null },
      { file: "CustomsOffice.png", hashPath: expect.stringMatching(/^[0-9a-f]\/[0-9a-f]{2}$/), caption: "The office", section: "Guide", subsection: null },
      {
        file: "Docs_0022-Delivery_From_the_Past.png",
        hashPath: expect.any(String),
        caption: "Docs 0022 is under the desk, on top of the drawers",
        section: "Guide",
        subsection: null,
      },
      { file: "Chem1West2.png", hashPath: expect.any(String), caption: null, section: "Guide", subsection: "First spawn" },
      { file: "Chem1West.png", hashPath: "5/50", caption: "The west room", section: "Guide", subsection: "First spawn" },
      { file: "KlimovStreetSignalAreaNote.png", hashPath: expect.any(String), caption: null, section: "Guide", subsection: "First spawn" },
      { file: "Gunsmithpart1Modding.png", hashPath: expect.any(String), caption: null, section: "Guide", subsection: "First spawn" },
      {
        file: "The_Ticket_Flowchart_by_Callsign_Smokey.png",
        hashPath: expect.any(String),
        caption: "Endings flowchart",
        section: "Guide",
        subsection: "First spawn",
      },
    ]);
  });

  it("says why it leaves out banners, icons, portraits, item links, small sizes and reward previews", () => {
    const reasons = Object.fromEntries(surveyImages(DELIVERY, "Delivery From the Past").map((image) => [image.file, image.leftOut]));
    expect(reasons).toMatchObject({
      "Old_Patterns_Pockets_Upgrade.png": "section",
      "KillaHelmet_with_FS.png": "section",
      "Customs-office-key-Icon.png": "name",
      "Car_Battery_Icon.png": "name",
      "Weightfatigue.12.4.png": "size",
      "Savior_icon.png": "name",
      "Therapist_Portrait.png": "name",
      "Gaming_magazine_reference.png": "section",
    });
    // The infobox picture is a template field, not a file link; comments and links to file pages show nothing.
    for (const file of ["Delivery_From_the_Past_Banner.png", "Hidden_map.png", "Linked_only.png", "Direct.png"]) {
      expect(reasons).not.toHaveProperty(file);
    }
  });

  it("leaves out an item picture by its link and a tab label by its class", () => {
    const text = [
      "==Guide==",
      "[[File:Custommp133.png|frameless|link=MP-133 custom plastic forestock with rails]]",
      "[[File:Fence.png|105x305px|link=|class=wds-tabs__tab-label|Fence]]",
    ].join("\n");
    expect(surveyImages(text, "Gunsmith").map((image) => image.leftOut)).toEqual(["link", "tab label"]);
  });

  it("names a section the way the page's sections do, and keeps requirements' start locations", () => {
    const text = [
      "Intro [[File:Intro map.png|thumb|The start]]",
      "==Requirements==",
      "Read the [[EMERCOM leaflet]].",
      '<gallery widths="300" heights="169" mode="packed">',
      "File:Blue Fire Woods Activation Location Map.png|Container marked on map",
      "</gallery>",
      "== '''Guide''' ==",
      "{{Seasonal change|text}}",
      "=== [[Customs]] ===",
      "[[File:Customs spot.png|400px]]",
      "==== Fine detail ====",
      "[[File:Detail.png]]",
    ].join("\n");
    expect(questImages(text, "Blue Fire").map(({ file, section, subsection, caption }) => [file, section, subsection, caption])).toEqual([
      ["Intro_map.png", "Introduction", null, "The start"],
      ["Blue_Fire_Woods_Activation_Location_Map.png", "Requirements", null, "Container marked on map"],
      ["Customs_spot.png", "Guide", "Customs", null],
      ["Detail.png", "Guide", "Fine detail", null],
    ]);
  });

  it("doesn't take a heading inside a table or template as a section break", () => {
    const text = ["==Guide==", "{|", "|", "==Not a heading==", "|}", "[[File:Spot.png]]"].join("\n");
    expect(questImages(text, "Quest")[0]).toMatchObject({ section: "Guide", subsection: null });
  });
});
