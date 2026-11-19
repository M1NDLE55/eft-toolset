import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_RETRY_DELAYS_MS, WikiImageStrip, WikiImages } from "@/app/components/quests/wiki-images";
import { placeWikiImages } from "@/app/lib/quests/wiki-images";
import type { QuestMap, QuestObjective } from "@/app/lib/quests/types";
import type { QuestWikiPageImage } from "@/app/lib/wiki/quest-wiki";
import { imageCreditParts, wikiImageUrl, wikiThumbSrcSet, wikiThumbUrl, type QuestWikiImage } from "@/app/lib/wiki/wiki-images";
import { WIKI_LICENCE } from "@/app/lib/wiki/wiki-url";

const image = (overrides: Partial<QuestWikiPageImage> = {}): QuestWikiPageImage => ({
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
    vi.useRealTimers();
  });

  function mount(images: QuestWikiImage[]) {
    root = createRoot(host);
    act(() => root!.render(<WikiImages images={images} title="From the EFT Wiki" />));
  }

  const fail = (img: Element) => act(() => void img.dispatchEvent(new Event("error")));
  const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-label^="Enlarge image"]')!;
  const escape = (target: Element) =>
    act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));

  it("renders nothing on the server, so no image URL is in the page's HTML", () => {
    const html = renderToString(<WikiImages images={[image()]} title="From the EFT Wiki" />);
    expect(html).toBe("");
    expect(renderToString(<WikiImageStrip groups={[{ label: null, images: [image()] }]} />)).toBe("");
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

  it("loads a scaled thumbnail in the grid, with a srcset the browser picks from by the grid's width", () => {
    mount([image()]);
    const img = host.querySelector("img")!;
    const base = "https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/4/4a/Delivery_from_the_past_Customs.png";
    expect(img.getAttribute("src")).toBe(`${base}/revision/latest/scale-to-width-down/400`);
    expect(img.getAttribute("srcset")).toBe(
      [400, 800, 1200].map((width) => `${base}/revision/latest/scale-to-width-down/${width} ${width}w`).join(", ")
    );
    expect(img.getAttribute("sizes")).toBe("(min-width: 640px) 256px, 50vw");
    expect(img.getAttribute("src")).not.toContain("?");
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

  it("tries a failed image again, with the same URL, before linking to the wiki instead", () => {
    vi.useFakeTimers();
    mount([image()]);
    const first = host.querySelector("img")!;
    const src = first.getAttribute("src");
    fail(first);
    // Hidden while it waits, not swapped for the link.
    expect(host.querySelector("img")!.className).toContain("invisible");
    expect(host.textContent).not.toContain("View on the EFT Wiki");
    act(() => void vi.advanceTimersByTime(IMAGE_RETRY_DELAYS_MS[0]));
    const second = host.querySelector("img")!;
    expect(second).not.toBe(first);
    expect(second.getAttribute("src")).toBe(src);
    expect(second.className).not.toContain("invisible");
    fail(second);
    act(() => void vi.advanceTimersByTime(IMAGE_RETRY_DELAYS_MS[1]));
    const third = host.querySelector("img")!;
    expect(third).not.toBe(second);
    expect(third.getAttribute("src")).toBe(src);
    fail(third);
    expect(host.querySelector("img")).toBeNull();
    const fallback = Array.from(host.querySelectorAll("a")).find((a) => a.textContent?.includes("View on the EFT Wiki"));
    expect(fallback?.getAttribute("href")).toBe(image().filePage);
    expect(host.textContent).toContain("Image: Delivery from the past Customs.png by Someone");
  });

  it("keeps an image that loads on a retry", () => {
    vi.useFakeTimers();
    mount([image()]);
    fail(host.querySelector("img")!);
    act(() => void vi.advanceTimersByTime(IMAGE_RETRY_DELAYS_MS[0]));
    act(() => void host.querySelector("img")!.dispatchEvent(new Event("load")));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(host.querySelectorAll("img")).toHaveLength(1);
    expect(host.textContent).not.toContain("View on the EFT Wiki");
  });

  it("credits a single image's uploader, or the wiki's contributors, with the licence", () => {
    mount([image({ uploader: null })]);
    expect(host.textContent).toContain("Image: Delivery from the past Customs.png by EFT Wiki contributors, Escape from Tarkov Wiki, CC BY-NC-SA");
    const links = Array.from(host.querySelectorAll("a"), (a) => a.getAttribute("href"));
    expect(links).toEqual([image().filePage, WIKI_LICENCE.url]);
    expect(host.querySelector('a[rel~="license"]')?.textContent).toBe(WIKI_LICENCE.name);
  });

  it("credits a group of images in one line, each file linking its page", () => {
    mount([image(), image({ file: "Other_one.png", uploader: null, filePage: "https://escapefromtarkov.fandom.com/wiki/File:Other_one.png" })]);
    expect(host.textContent).toContain(
      "Images: Delivery from the past Customs.png by Someone; Other one.png by EFT Wiki contributors, Escape from Tarkov Wiki, CC BY-NC-SA"
    );
    expect(Array.from(host.querySelectorAll("a"), (a) => a.getAttribute("href"))).toEqual([
      image().filePage,
      "https://escapefromtarkov.fandom.com/wiki/File:Other_one.png",
      WIKI_LICENCE.url,
    ]);
  });

  it("loads the full original only in the enlarged view", () => {
    mount([image()]);
    expect(Array.from(document.querySelectorAll("img"), (img) => img.getAttribute("src"))).not.toContain(wikiImageUrl(image()));
    act(() => trigger().click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("The office on the second floor");
    const full = dialog.querySelector("img")!;
    expect(full.getAttribute("src")).toBe(wikiImageUrl(image()));
    expect(full.hasAttribute("srcset")).toBe(false);
    expect(full.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(dialog.textContent).toContain("by Someone, Escape from Tarkov Wiki, CC BY-NC-SA");
  });

  it("closes the enlarged image with Escape wherever focus is inside it, and returns focus to the thumbnail", async () => {
    mount([image()]);
    const targets = [
      (dialog: Element) => Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Close")!,
      (dialog: Element) => dialog.querySelector('a[rel~="license"]')!,
      (dialog: Element) => Array.from(dialog.querySelectorAll("a")).find((a) => a.textContent?.includes(".png"))!,
      // The dialog itself, as after a click on the image.
      (dialog: Element) => dialog,
    ];
    for (const target of targets) {
      act(() => trigger().click());
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog).not.toBeNull();
      const element = target(dialog) as HTMLElement;
      act(() => element.focus());
      expect(document.activeElement).toBe(element);
      escape(element);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      // The dialog hands focus back once it has unmounted.
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(document.activeElement).toBe(trigger());
    }
  });

  it("keeps focus inside the enlarged image when tabbing past either end", () => {
    mount([image()]);
    act(() => trigger().click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const tabbable = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button"));
    const [first, last] = [tabbable[0], tabbable.at(-1)!];
    expect(tabbable.length).toBeGreaterThan(1);
    act(() => last.focus());
    act(() => void last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(first);
    act(() => void first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
    // Focus moved outside comes back in.
    act(() => trigger().focus());
    expect(dialog.contains(document.activeElement)).toBe(true);
    escape(document.activeElement!);
  });

  it("keeps the enlarged image open when its thumbnail gives up meanwhile, then shows the link", () => {
    vi.useFakeTimers();
    mount([image()]);
    act(() => trigger().click());
    const thumb = () => host.querySelector("button img");
    for (const delay of IMAGE_RETRY_DELAYS_MS) {
      fail(thumb()!);
      act(() => void vi.advanceTimersByTime(delay));
    }
    fail(thumb()!);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    escape(document.querySelector('[role="dialog"]')!);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain("View on the EFT Wiki");
  });

  it("retries the enlarged image too, and links to the wiki inside the dialog when it never loads", () => {
    vi.useFakeTimers();
    mount([image()]);
    act(() => trigger().click());
    const dialog = () => document.querySelector('[role="dialog"]')!;
    for (const delay of IMAGE_RETRY_DELAYS_MS) {
      fail(dialog().querySelector("img")!);
      act(() => void vi.advanceTimersByTime(delay));
    }
    fail(dialog().querySelector("img")!);
    expect(dialog().querySelector("img")).toBeNull();
    expect(dialog().textContent).toContain("View on the EFT Wiki");
    // The thumbnail is untouched.
    expect(host.querySelector("img")).not.toBeNull();
    escape(dialog());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the strip's groups under their labels", () => {
    root = createRoot(host);
    act(() =>
      root!.render(
        <WikiImageStrip
          groups={[
            { label: null, images: [image({ file: "Map.png" })] },
            { label: "First spawn", images: [image({ file: "One.png" }), image({ file: "Two.png" })] },
          ]}
        />
      )
    );
    const section = host.querySelector("section")!;
    expect(document.getElementById(section.getAttribute("aria-labelledby")!)?.textContent).toBe("From the EFT Wiki");
    expect(Array.from(host.querySelectorAll("h4"), (heading) => heading.textContent)).toEqual(["First spawn"]);
    expect(host.querySelectorAll("img")).toHaveLength(3);
  });
});

describe("thumbnail URLs", () => {
  it("scale the CDN's file down to a width, with no query string", () => {
    const file = { file: "Tom_&_Jerry?.png", hashPath: "0/0f" };
    expect(wikiThumbUrl(file, 800)).toBe(
      "https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/0/0f/Tom_%26_Jerry%3F.png/revision/latest/scale-to-width-down/800"
    );
    expect(wikiThumbSrcSet(file).split(", ").map((entry) => entry.split(" ")[1])).toEqual(["400w", "800w", "1200w"]);
    expect(imageCreditParts({ ...file, uploader: null, filePage: "x" })[1].text).toBe("Tom & Jerry?.png");
  });
});

describe("placing wiki images by the objectives", () => {
  const maps: Record<string, QuestMap> = {
    customs: { key: "customs", name: "Customs", page: "customs" },
    factory: { key: "factory", name: "Factory", page: "factory" },
    "night-factory": { key: "night-factory", name: "Night Factory", page: "factory" },
    woods: { key: "woods", name: "Woods", page: "woods" },
    "streets-of-tarkov": { key: "streets-of-tarkov", name: "Streets of Tarkov", page: "streets-of-tarkov" },
  };
  const objective = (id: string, description: string, mapKeys: string[], type: string | null = null): QuestObjective => ({
    id,
    type,
    description,
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
  const files = (placed: ReturnType<typeof placeWikiImages>) => ({
    objectives: Object.fromEntries(Object.entries(placed.objectives).map(([id, entries]) => [id, entries.map((entry) => entry.file)])),
    strip: placed.strip.map((group) => [group.label, group.images.map((entry) => entry.file)]),
  });

  it("puts each step's map and the pictures after it under that step (Delivery From the Past)", () => {
    const objectives = [
      objective("get", "Locate and obtain the valuable folder in Tarcone director's office on Customs", ["customs"], "findQuestItem"),
      objective("stash", "Stash the package in the break room on the 2nd floor near Gate 3 on Factory", ["factory", "night-factory"], "plantQuestItem"),
    ];
    const placed = placeWikiImages(
      [
        image({ file: "Delivery_from_the_past_Customs.png", caption: "Warehouse marked on map" }),
        // "Factory1" isn't the word Factory: the file name names Customs alone.
        image({ file: "Customs-Factory1-Outside-3.png", caption: "The warehouse" }),
        image({ file: "CustomsOffice.png", caption: "The office" }),
        image({ file: "Farming3Office.png", caption: "The second room" }),
        image({ file: "Docs_0022-Delivery_From_the_Past.png", caption: "Docs 0022 is under the desk, on top of the drawers" }),
        image({ file: "Delivery_from_the_past_Factory.png", caption: "Break room marked on map" }),
        image({ file: "Delivery_from_the_past_dropoff.png", caption: "The sheet metal break room where you have to place the documents" }),
      ],
      objectives,
      maps
    );
    expect(files(placed)).toEqual({
      objectives: {
        get: [
          "Delivery_from_the_past_Customs.png",
          "Customs-Factory1-Outside-3.png",
          "CustomsOffice.png",
          "Farming3Office.png",
          "Docs_0022-Delivery_From_the_Past.png",
        ],
        stash: ["Delivery_from_the_past_Factory.png", "Delivery_from_the_past_dropoff.png"],
      },
      strip: [],
    });
  });

  it("matches a variant's map by the map it shares a page with, and skips surviving and handing over (Bad Rep Evidence)", () => {
    const objectives = [
      objective("get", "Locate and obtain Secure Folder 0031 in one of the bunkhouses on Customs", ["customs"], "findQuestItem"),
      objective("room", "Gain access to the locked room in the office hallway on the third floor on Factory", ["night-factory"], "visit"),
      objective("key", "Obtain the Portable bunkhouse key", [], "findItem"),
      objective("give", "Hand over the folder", [], "giveQuestItem"),
      objective("survive", "Survive and extract from the location", ["customs"], "extract"),
    ];
    const placed = placeWikiImages(
      [
        image({ file: "Bad_Rep_Evidence_Customs.png", caption: "Bunkhouse location marked on map" }),
        image({ file: "Customs-Portable-cabin-portable.png", caption: "The bunkhouse" }),
        image({ file: "Docs_0031_location.png", caption: "The secure folder on the table" }),
        image({ file: "Hallway.png", caption: "The hallway on Night Factory" }),
      ],
      objectives,
      maps
    );
    expect(files(placed).objectives).toEqual({
      get: ["Bad_Rep_Evidence_Customs.png", "Customs-Portable-cabin-portable.png", "Docs_0031_location.png"],
      room: ["Hallway.png"],
    });
  });

  it("keeps images in the strip when two objectives share the place (Golden Swag)", () => {
    const objectives = [
      objective("get", "Locate and obtain the golden Zibbo lighter from Dorm room 303 on Customs", ["customs"], "findQuestItem"),
      objective("give", "Hand over the found item", [], "giveQuestItem"),
      objective("stash", "Stash a regular Zibbo lighter at Dorm room 303 on Customs", ["customs"], "plantItem"),
    ];
    const placed = placeWikiImages(
      [
        image({ file: "GoldenSwagMarkedMap.png", caption: "3 story dorms and room 303 marked on map" }),
        image({ file: "Gilded-Zibbo-Location.png", caption: "The lighter on the desk" }),
      ],
      objectives,
      maps
    );
    expect(files(placed)).toEqual({ objectives: {}, strip: [[null, ["GoldenSwagMarkedMap.png", "Gilded-Zibbo-Location.png"]]] });
  });

  it("groups the strip by subsection (Chemical - Part 1)", () => {
    const objectives = [
      objective("info", "Locate and obtain any information about the deputy chief's past life on Customs", ["customs"], "findQuestItem"),
      objective("bed", "Locate the sleeping place of the former deputy chief of security on Customs", ["customs"], "visit"),
    ];
    const placed = placeWikiImages(
      [
        image({ file: "Chemical1_Traincar_Map.png", caption: "Train car marked on map" }),
        image({ file: "Chem1West2.png", caption: null, subsection: "First spawn" }),
        image({ file: "Chem1West.png", caption: null, subsection: "First spawn" }),
        image({ file: "Chem1East3.png", caption: null, subsection: "Second spawn" }),
        image({ file: "Docs.png", caption: null, section: "Requirements" }),
      ],
      objectives,
      maps
    );
    expect(files(placed)).toEqual({
      objectives: {},
      strip: [
        [null, ["Chemical1_Traincar_Map.png"]],
        ["First spawn", ["Chem1West2.png", "Chem1West.png"]],
        ["Second spawn", ["Chem1East3.png"]],
        ["Requirements", ["Docs.png"]],
      ],
    });
  });

  it("lets a caption's own words pick among objectives on one map, over the image before it (Break the Deal)", () => {
    const objectives = [
      objective("rifle", "Stash a DVL-10 sniper rifle at the specified spot on Customs", ["customs"], "plantItem"),
      objective("mag", "Stash a DVL-10 magazine at the specified spot on Customs", ["customs"], "plantItem"),
      objective("scope", "Stash an ELCAN SpecterDR scope at the specified spot on Customs", ["customs"], "plantItem"),
    ];
    const placed = placeWikiImages(
      [
        image({ file: "Customs_industrial_plant_map.png", caption: "Building location marked on map" }),
        image({ file: "Spot_1.png", caption: "SpecterDR scope spot: 2nd floor" }),
        image({ file: "Spot_2.png", caption: "DVL-10 magazine spot: 3rd floor" }),
        image({ file: "Spot_4.png", caption: "DVL-10 rifle spot: 4th floor" }),
      ],
      objectives,
      maps
    );
    expect(files(placed)).toEqual({
      objectives: { scope: ["Spot_1.png"], mag: ["Spot_2.png"], rifle: ["Spot_4.png"] },
      strip: [[null, ["Customs_industrial_plant_map.png"]]],
    });
  });

  it("doesn't carry an image over to an objective its caption points away from (Revision - Streets of Tarkov)", () => {
    const objectives = [
      objective("lav1", "Locate and mark the first LAV III with an MS2000 Marker on Streets of Tarkov", ["streets-of-tarkov"], "mark"),
      objective("stryker", "Locate and mark the Stryker with an MS2000 Marker on Streets of Tarkov", ["streets-of-tarkov"], "mark"),
      objective("lav2", "Locate and mark the second LAV III with an MS2000 Marker on Streets of Tarkov", ["streets-of-tarkov"], "mark"),
    ];
    const placed = placeWikiImages(
      [image({ file: "Stryker2.png", caption: "Stryker" }), image({ file: "Stryker3.png", caption: "LAV III 2" })],
      objectives,
      maps
    );
    expect(files(placed)).toEqual({ objectives: { stryker: ["Stryker2.png"] }, strip: [[null, ["Stryker3.png"]]] });
  });

  it("puts guide images under the only objective on a map, but not ones naming another map or from other sections", () => {
    const objectives = [objective("find", "Locate the hideout on Woods", ["woods"], "visit"), objective("give", "Hand over the message", [])];
    // As on the quest page: only the quest's own maps, so Customs is known by the game's map names.
    const questMaps = { woods: maps.woods };
    const placed = placeWikiImages(
      [
        image({ file: "Hideout.png", caption: "Hideout with message location" }),
        image({ file: "Elsewhere.png", caption: "The same spot on Customs" }),
        image({ file: "Gear.png", caption: null, section: "Build" }),
      ],
      objectives,
      questMaps
    );
    expect(files(placed)).toEqual({
      objectives: { find: ["Hideout.png"] },
      strip: [
        [null, ["Elsewhere.png"]],
        ["Build", ["Gear.png"]],
      ],
    });
  });

  it("knows a map by its short name and a variant by its base map, even when the quest's maps lack it", () => {
    const objectives = [
      objective("lab", "Find the server on The Lab", ["the-lab-dark"], "visit"),
      objective("night", "Stash it on Factory", ["night-factory"], "plantItem"),
    ];
    const questMaps: Record<string, QuestMap> = {
      "the-lab-dark": { key: "the-lab-dark", name: "The Lab (Dark)", page: "the-lab" },
      "night-factory": maps["night-factory"],
    };
    const placed = placeWikiImages(
      [image({ file: "Server.png", caption: "The server room in Labs" }), image({ file: "Stash.png", caption: "The shack on Factory" })],
      objectives,
      questMaps
    );
    expect(files(placed).objectives).toEqual({ lab: ["Server.png"], night: ["Stash.png"] });
  });

  it("doesn't take an objective on most maps for the one a picture shows", () => {
    const anywhere = ["customs", "factory", "woods", "shoreline", "interchange", "reserve", "lighthouse", "streets-of-tarkov"];
    const objectives = [objective("kill", "Eliminate PMCs", anywhere, "shoot"), objective("give", "Hand over the tags", [])];
    const placed = placeWikiImages([image({ file: "Tags.png", caption: "A dogtag" })], objectives, maps);
    expect(files(placed)).toEqual({ objectives: {}, strip: [[null, ["Tags.png"]]] });
  });

  it("merges the strip's unlabelled images into one group", () => {
    const placed = placeWikiImages(
      [
        image({ file: "A.png", caption: null }),
        image({ file: "B.png", caption: null, subsection: "First spawn" }),
        image({ file: "C.png", caption: null }),
      ],
      [],
      maps
    );
    expect(files(placed).strip).toEqual([
      [null, ["A.png", "C.png"]],
      ["First spawn", ["B.png"]],
    ]);
  });

  it("shows each image once and passes on only the fields the browser needs", () => {
    const objectives = [objective("find", "Find it on Woods", ["woods"])];
    const extra = { ...image({ file: "Woods.png" }), sectionOccurrence: 1, url: "https://example.org/x.png" } as QuestWikiPageImage;
    const placed = placeWikiImages([extra, image({ file: "Other_map.png", caption: "On Customs" }), extra], objectives, maps);
    const all = [...Object.values(placed.objectives).flat(), ...placed.strip.flatMap((group) => group.images)];
    expect(all.map((entry) => entry.file)).toEqual(["Woods.png", "Other_map.png"]);
    expect(Object.keys(placed.objectives.find[0]).toSorted()).toEqual(
      ["caption", "file", "filePage", "hashPath", "section", "subsection", "uploader"].toSorted()
    );
  });
});
