// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { creditsFile, fetchImageCredits, filePageUrl, updateImageCredits } from "../scripts/wiki-image-credits.mjs";

const IMAGES = [
  { file: "Delivery_from_the_past_Customs.png", hashPath: "4/4a" },
  { file: "Chem1West.png", hashPath: "5/50" },
  { file: "Gone.png", hashPath: "0/00" },
];

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8" }, ...init });
}

function apiFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.headers).toBeDefined();
    const params = new URL(url).searchParams;
    expect(params.get("format")).toBe("json");
    expect(params.get("formatversion")).toBe("2");
    expect(params.get("maxlag")).toBe("5");
    if (params.get("meta") === "siteinfo") {
      return json({ query: { rightsinfo: { url: "https://www.fandom.com/licensing", text: "CC BY-NC-SA" } } });
    }
    expect(params.get("titles")).toBe("File:Delivery from the past Customs.png|File:Chem1West.png|File:Gone.png");
    return json({
      query: {
        normalized: [{ from: "File:Delivery from the past Customs.png", to: "File:Delivery from the past Customs.png" }],
        pages: [
          { title: "File:Gone.png", missing: true },
          {
            title: "File:Delivery from the past Customs.png",
            imageinfo: [
              {
                user: "Muhawi",
                url: "https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/4/4a/Delivery_from_the_past_Customs.png/revision/latest?cb=1",
              },
            ],
          },
          {
            title: "File:Chem1West.png",
            imageinfo: [{ user: "Someone", url: "https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/5/51/Chem1West.png/revision/latest" }],
          },
        ],
      },
    });
  });
}

describe("the image credit pass", () => {
  it("asks the API for each image's uploader and checks its URL against the one built from the name", async () => {
    const fetch = apiFetch();
    const result = await fetchImageCredits(IMAGES, { fetch, userAgent: "Test/1.0", delayMs: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { "User-Agent": "Test/1.0" } });
    expect(result.licence).toEqual({ name: "CC BY-NC-SA", url: "https://www.fandom.com/licensing" });
    expect(result.credits).toEqual({
      "Delivery_from_the_past_Customs.png": {
        uploader: "Muhawi",
        filePage: "https://escapefromtarkov.fandom.com/wiki/File:Delivery_from_the_past_Customs.png",
      },
      "Chem1West.png": { uploader: "Someone", filePage: "https://escapefromtarkov.fandom.com/wiki/File:Chem1West.png" },
      "Gone.png": { uploader: null, filePage: "https://escapefromtarkov.fandom.com/wiki/File:Gone.png", missing: true },
    });
    expect(result.missing).toEqual(["Gone.png"]);
    expect(result.mismatches).toEqual([
      { file: "Chem1West.png", built: "5/50/Chem1West.png", api: expect.stringContaining("/images/5/51/Chem1West.png") },
    ]);
  });

  it("asks for at most fifty titles at a time", async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({ file: `Spot_${index}.png`, hashPath: "0/00" }));
    const fetch = vi.fn(async (url: string) => {
      const titles = new URL(url).searchParams.get("titles");
      expect(titles === null || titles.split("|").length <= 50).toBe(true);
      return json({ query: { pages: [], rightsinfo: {} } });
    });
    await fetchImageCredits(many, { fetch, userAgent: "Test/1.0", delayMs: 0 });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("keeps the existing credits when the API can't be reached or answers with a challenge page", async () => {
    const existing = creditsFile(IMAGES.slice(0, 1), {
      fetched: { "Delivery_from_the_past_Customs.png": { uploader: "Muhawi", filePage: filePageUrl("Delivery_from_the_past_Customs.png") } },
      fetchedAt: "2026-11-12T00:00:00.000Z",
      licence: { name: "CC BY-NC-SA", url: "https://www.fandom.com/licensing" },
    });
    const failing = [
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      vi.fn(async () => new Response("<title>Just a moment...</title>", { status: 403, headers: { "content-type": "text/html" } })),
    ];
    for (const fetch of failing) {
      const result = await updateImageCredits(IMAGES, { existing, fetch, userAgent: "Test/1.0", delayMs: 0 });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.fetched).toBe(false);
      expect(result.warnings[0]).toMatch(/not fetched/);
      expect(result.file).toEqual({
        fetchedAt: "2026-11-12T00:00:00.000Z",
        licence: { name: "CC BY-NC-SA", url: "https://www.fandom.com/licensing" },
        images: {
          "Chem1West.png": { uploader: null, filePage: "https://escapefromtarkov.fandom.com/wiki/File:Chem1West.png" },
          "Delivery_from_the_past_Customs.png": {
            uploader: "Muhawi",
            filePage: "https://escapefromtarkov.fandom.com/wiki/File:Delivery_from_the_past_Customs.png",
          },
          "Gone.png": { uploader: null, filePage: "https://escapefromtarkov.fandom.com/wiki/File:Gone.png" },
        },
      });
    }
  });

  it("makes no request offline, and writes no uploader without an existing file", async () => {
    const fetch = vi.fn();
    const result = await updateImageCredits(IMAGES.slice(1, 2), { offline: true, fetch, userAgent: "Test/1.0" });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.file).toEqual({
      fetchedAt: null,
      licence: null,
      images: { "Chem1West.png": { uploader: null, filePage: "https://escapefromtarkov.fandom.com/wiki/File:Chem1West.png" } },
    });
  });

  it("records the fetch time and drops images no page shows any more", async () => {
    const existing = { fetchedAt: "old", licence: null, images: { "Old.png": { uploader: "A", filePage: "x" } } };
    const result = await updateImageCredits(IMAGES, {
      existing,
      fetch: apiFetch(),
      userAgent: "Test/1.0",
      delayMs: 0,
      now: () => new Date("2026-11-19T00:00:00Z"),
    });
    expect(result.file.fetchedAt).toBe("2026-11-19T00:00:00.000Z");
    expect(Object.keys(result.file.images)).toEqual(["Chem1West.png", "Delivery_from_the_past_Customs.png", "Gone.png"]);
    expect(result.file.images["Gone.png"]).toMatchObject({ uploader: null, missing: true });
  });
});
