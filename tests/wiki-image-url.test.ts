import { describe, expect, it } from "vitest";
import { imageCredit, WIKI_IMAGE_HOST, wikiImageUrl } from "@/app/lib/wiki/wiki-images";

describe("a wiki image's URL and credit", () => {
  it("builds the CDN URL from the hash path and file name", () => {
    expect(WIKI_IMAGE_HOST).toBe("https://static.wikia.nocookie.net");
    expect(wikiImageUrl({ file: "Delivery_from_the_past_Customs.png", hashPath: "4/4a" })).toBe(
      "https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/4/4a/Delivery_from_the_past_Customs.png"
    );
    expect(wikiImageUrl({ file: "Tom_&_Jerry?.png", hashPath: "0/0f" })).toBe(
      "https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/0/0f/Tom_%26_Jerry%3F.png"
    );
  });

  it("credits the uploader, or the wiki's contributors when unknown", () => {
    expect(imageCredit({ file: "Chem1West.png", uploader: "Muhawi" })).toBe(
      "Image: Chem1West.png by Muhawi, Escape from Tarkov Wiki, CC BY-NC-SA"
    );
    expect(imageCredit({ file: "Delivery_from_the_past_Customs.png", uploader: null })).toBe(
      "Image: Delivery from the past Customs.png by EFT Wiki contributors, Escape from Tarkov Wiki, CC BY-NC-SA"
    );
  });
});
