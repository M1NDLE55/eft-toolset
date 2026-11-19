import { describe, expect, it } from "vitest";
import { imageCreditParts, wikiImageUrl } from "@/app/lib/wiki/wiki-images";
import { WIKI_LICENCE } from "@/app/lib/wiki/wiki-url";

const credit = (image: { file: string; uploader: string | null }) =>
  imageCreditParts({ ...image, filePage: `https://escapefromtarkov.fandom.com/wiki/File:${image.file}` });

describe("a wiki image's URL and credit", () => {
  it("builds the CDN URL from the hash path and file name", () => {
    expect(wikiImageUrl({ file: "Delivery_from_the_past_Customs.png", hashPath: "4/4a" })).toBe(
      "https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/4/4a/Delivery_from_the_past_Customs.png"
    );
    expect(wikiImageUrl({ file: "Tom_&_Jerry?.png", hashPath: "0/0f" })).toBe(
      "https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/0/0f/Tom_%26_Jerry%3F.png"
    );
  });

  it("credits the uploader, or the wiki's contributors when unknown", () => {
    expect(credit({ file: "Chem1West.png", uploader: "Muhawi" }).map((part) => part.text).join("")).toBe(
      "Image: Chem1West.png by Muhawi, Escape from Tarkov Wiki, CC BY-NC-SA"
    );
    expect(credit({ file: "Delivery_from_the_past_Customs.png", uploader: null }).map((part) => part.text).join("")).toBe(
      "Image: Delivery from the past Customs.png by EFT Wiki contributors, Escape from Tarkov Wiki, CC BY-NC-SA"
    );
  });

  it("links the file page and the licence", () => {
    expect(credit({ file: "Chem1West.png", uploader: null }).filter((part) => part.href)).toEqual([
      { text: "Chem1West.png", href: "https://escapefromtarkov.fandom.com/wiki/File:Chem1West.png" },
      { text: WIKI_LICENCE.name, href: WIKI_LICENCE.url, license: true },
    ]);
  });
});
