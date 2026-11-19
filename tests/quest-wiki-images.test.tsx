import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiImages } from "@/app/components/quests/wiki-images";
import { WikiSections } from "@/app/components/wiki/wiki-text";
import { groupWikiSections } from "@/app/lib/wiki/page-sections";
import { placeWikiImages, sectionKey } from "@/app/lib/quests/wiki-images";
import type { QuestMap, QuestObjective } from "@/app/lib/quests/types";
import type { WikiPageSection } from "@/app/lib/wiki/page-sections";
import { imageCreditParts, wikiImageUrl, type QuestWikiImage } from "@/app/lib/wiki/wiki-images";
import { WIKI_LICENCE } from "@/app/lib/wiki/wiki-url";

const image = (overrides: Partial<QuestWikiImage> = {}): QuestWikiImage => ({
  file: "Delivery_from_the_past_Customs.png",
  hashPath: "4/4a",
  caption: "The office on the second floor",
  section: "Guide",
  subsection: null,
  uploader: "Someone",
  filePage: "https://escapefromtarkov.fandom.com/wiki/File:Delivery_from_the_past_Customs.png",
  ...overrides,
});

describe("wiki images", () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = null;
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host.remove();
  });

  function mount(images: QuestWikiImage[]) {
    root = createRoot(host);
    act(() => root!.render(<WikiImages images={images} title="From the EFT Wiki" />));
  }

  it("renders nothing on the server, so no image URL is in the page's HTML", () => {
    const html = renderToString(<WikiImages images={[image()]} title="From the EFT Wiki" />);
    expect(html).toBe("");
  });

  it("hydrates the empty server output without a mismatch and then shows the images", () => {
    const onRecoverableError = vi.fn();
    host.innerHTML = renderToString(<WikiImages images={[image()]} />);
    act(() => {
      root = hydrateRoot(host, <WikiImages images={[image()]} />, { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(host.querySelectorAll("img")).toHaveLength(1);
  });

  it("builds the image URL in the browser from the file name and hash path", () => {
    mount([image()]);
    const img = host.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(wikiImageUrl(image()));
    expect(img.getAttribute("src")).toBe("https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/4/4a/Delivery_from_the_past_Customs.png");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(img.getAttribute("alt")).toBe("The office on the second floor");
    expect(host.textContent).toContain("From the EFT Wiki");
  });

  it("uses the file name as alt text without a caption", () => {
    mount([image({ caption: null })]);
    expect(host.querySelector("img")!.getAttribute("alt")).toBe("Delivery from the past Customs.png");
  });

  it("links to the wiki's file page when the image fails to load", () => {
    mount([image()]);
    act(() => {
      host.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(host.querySelector("img")).toBeNull();
    const fallback = Array.from(host.querySelectorAll("a")).find((a) => a.textContent?.includes("View on the EFT Wiki"));
    expect(fallback?.getAttribute("href")).toBe(image().filePage);
    expect(host.textContent).toContain("Image: Delivery from the past Customs.png by Someone");
  });

  it("credits the image's uploader, or the wiki's contributors, with the licence", () => {
    mount([image({ uploader: null })]);
    const credit = host.querySelector("figcaption")!;
    expect(credit.textContent).toContain("Image: Delivery from the past Customs.png by EFT Wiki contributors, Escape from Tarkov Wiki, CC BY-NC-SA");
    expect(credit.querySelector("span:last-child")!.textContent).toBe(imageCreditParts(image({ uploader: null })).map((part) => part.text).join(""));
    expect(Array.from(credit.querySelectorAll("a"), (a) => a.getAttribute("href"))).toEqual([image().filePage, WIKI_LICENCE.url]);
    expect(credit.querySelector('a[rel~="license"]')?.textContent).toBe(WIKI_LICENCE.name);
  });

  it("opens the full image in a dialog and closes it with Escape", () => {
    mount([image()]);
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label^="Enlarge image"]')!;
    act(() => trigger.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("The office on the second floor");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(wikiImageUrl(image()));
    expect(dialog.textContent).toContain("by Someone, Escape from Tarkov Wiki, CC BY-NC-SA");
    expect(Array.from(dialog.querySelectorAll("button")).some((button) => button.textContent === "Close")).toBe(true);
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("placing wiki images", () => {
  const maps: Record<string, QuestMap> = {
    customs: { key: "customs", name: "Customs", page: "customs" },
    factory: { key: "factory", name: "Factory", page: "factory" },
    "night-factory": { key: "night-factory", name: "Night Factory", page: "factory" },
  };
  const objective = (id: string, mapKeys: string[]): QuestObjective => ({
    id,
    type: null,
    description: id,
    count: null,
    foundInRaid: false,
    optional: false,
    maps: mapKeys,
    items: [],
    alternatives: 0,
    questItem: null,
    requiredKeys: [],
    conditions: [],
  });
  const guide: WikiPageSection[] = [{ heading: "Guide", text: "Go there.", subsections: [{ heading: "Customs", text: "The office." }] }];
  const objectives = [objective("get", ["customs"]), objective("stash", ["factory", "night-factory"]), objective("survive", ["factory"])];

  it("keeps images with the section or subsection the page shows", () => {
    const placed = placeWikiImages(
      [image({ subsection: "Customs" }), image({ file: "B.png", subsection: "Not shown" }), image({ file: "C.png", section: "guide" })],
      guide,
      objectives,
      maps
    );
    expect(placed.sections.get(sectionKey("Guide", 0, "Customs"))?.map((entry) => entry.file)).toEqual(["Delivery_from_the_past_Customs.png"]);
    expect(placed.sections.get(sectionKey("Guide"))?.map((entry) => entry.file)).toEqual(["B.png", "C.png"]);
    expect(placed.other).toEqual([]);
  });

  it("puts an image from a left-out section under the one objective on the map it names", () => {
    const placed = placeWikiImages([image({ section: "Objectives", caption: "Where to find it on Customs" })], guide, objectives, maps);
    expect(Object.keys(placed.objectives)).toEqual(["get"]);
  });

  it("falls back to the file name when the caption names no map", () => {
    const placed = placeWikiImages([image({ section: "Objectives", caption: "The office" })], guide, objectives, maps);
    expect(Object.keys(placed.objectives)).toEqual(["get"]);
  });

  it("keeps an image by the objectives, under its section's name, when its map has several objectives or it names several maps", () => {
    const placed = placeWikiImages(
      [
        image({ file: "Factory_shack.png", section: "Objectives", caption: null }),
        image({ file: "None.png", section: "Requirements", caption: "A folder" }),
        image({ file: "Both.png", section: "Objectives", caption: "Customs and Factory" }),
      ],
      guide,
      objectives,
      maps
    );
    expect(placed.objectives).toEqual({});
    expect(placed.other.map((group) => [group.section, group.images.map((entry) => entry.file)])).toEqual([
      ["Objectives", ["Factory_shack.png", "Both.png"]],
      ["Requirements", ["None.png"]],
    ]);
  });

  it("passes on only the fields the browser needs", () => {
    const extra = { ...image(), sectionOccurrence: 0, url: "https://example.org/x.png" } as QuestWikiImage;
    const placed = placeWikiImages([extra], guide, objectives, maps);
    expect(Object.keys(placed.sections.get(sectionKey("Guide"))![0]).toSorted()).toEqual(
      ["caption", "file", "filePage", "hashPath", "section", "subsection", "uploader"].toSorted()
    );
  });

  it("shows each image once, in the namesake section or subsection it sits in", () => {
    // Shaped like From Hand to Hand (two Guide sections) and Batya (Woods and Customs subsections repeated).
    const sections = groupWikiSections(
      [
        { heading: "Introduction", level: 1, text: "A quest." },
        { heading: "Guide", level: 2, text: "First guide." },
        { heading: "Woods", level: 3, text: "The first Woods." },
        { heading: "Customs", level: 3, text: "" },
        { heading: "Note", level: 3, text: "A note." },
        { heading: "Woods", level: 4, text: "The second Woods." },
        { heading: "Customs", level: 4, text: "The second Customs." },
        { heading: "Guide", level: 2, text: "Second guide." },
      ],
      new Set(["introduction"])
    );
    expect(sections.map((section) => [section.heading, section.occurrence ?? 0])).toEqual([
      ["Guide", 0],
      ["Guide", 1],
    ]);
    expect(sections[0].subsections.map((subsection) => [subsection.heading, subsection.occurrence ?? 0])).toEqual([
      ["Woods", 0],
      ["Note", 0],
      ["Woods", 1],
      ["Customs", 1],
    ]);
    const placed = placeWikiImages(
      [
        image({ file: "First_guide.png" }),
        image({ file: "Second_guide.png", sectionOccurrence: 1 } as Partial<QuestWikiImage>),
        image({ file: "First_woods.png", subsection: "Woods" }),
        image({ file: "Second_woods.png", subsection: "Woods", subsectionOccurrence: 1 } as Partial<QuestWikiImage>),
        image({ file: "First_customs.png", subsection: "Customs" }),
        image({ file: "Second_customs.png", subsection: "Customs", subsectionOccurrence: 1 } as Partial<QuestWikiImage>),
      ],
      sections,
      [],
      maps
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<WikiSections sections={sections} images={placed.sections} />));
    const blocks = Array.from(host.querySelectorAll("h3, h4"), (heading) => [
      heading.textContent,
      Array.from(heading.parentElement!.querySelectorAll(":scope > div:not(.border-l) img"), (img) => img.getAttribute("src")!.split("/").at(-1)),
    ]);
    expect(blocks).toEqual([
      // The first Customs has no text, so its image shows with its section.
      ["Guide", ["First_guide.png", "First_customs.png"]],
      ["Woods", ["First_woods.png"]],
      ["Note", []],
      ["Woods", ["Second_woods.png"]],
      ["Customs", ["Second_customs.png"]],
      ["Guide", ["Second_guide.png"]],
    ]);
    expect(host.querySelectorAll("img")).toHaveLength(6);
    act(() => root.unmount());
    host.remove();
  });
});
