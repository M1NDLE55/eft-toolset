import { describe, expect, it } from "vitest";
import { pageHead, ROOT_METADATA, type Metadata } from "@/app/lib/seo/metadata";

const tag = (head: ReturnType<typeof pageHead>, key: string) =>
  head.meta.filter((entry) => entry.name === key || entry.property === key).map((entry) => entry.content);
const title = (head: ReturnType<typeof pageHead>) => head.meta.find((entry) => "title" in entry)?.title;

describe("page metadata", () => {
  it("uses the site's defaults where a page sets nothing", () => {
    const head = pageHead();
    expect(title(head)).toBe("EFT Toolset");
    expect(tag(head, "og:url")).toEqual(["https://www.eft-toolset.com"]);
    expect(tag(head, "twitter:card")).toEqual(["summary_large_image"]);
    expect(head.links).toEqual([{ rel: "manifest", href: "/manifest.webmanifest" }]);
  });

  it("templates a page's title from the root, unless a layout above it set a plain title", () => {
    const layout: Metadata = { title: "Gun builder" };
    expect(title(pageHead({ page: { title: "Credits" } }))).toBe("Credits | EFT Toolset");
    expect(title(pageHead({ own: layout, page: { title: "Best builds" } }))).toBe("Best builds | EFT Toolset");
    expect(title(pageHead({ layouts: [layout], page: { title: "Best builds" } }))).toBe("Best builds");
    expect(title(pageHead({ layouts: [layout] }))).toBe("Gun builder | EFT Toolset");
    expect(title(pageHead({ page: { title: { absolute: "Exactly this" } } }))).toBe("Exactly this");
  });

  it("replaces a layout's Open Graph object wholesale, and fills the Twitter card from it", () => {
    const head = pageHead({
      layouts: [{ openGraph: { title: "Layout", siteName: "EFT Toolset" } }],
      page: {
        title: "Quests",
        description: "Every quest.",
        openGraph: { title: "Quests | EFT Toolset", url: "/quests", images: [{ url: "/home-og-image.png", width: 1200, height: 630 }] },
        twitter: null,
      },
    });
    expect(tag(head, "og:site_name")).toEqual([]);
    expect(tag(head, "og:description")).toEqual(["Every quest."]);
    expect(tag(head, "twitter:card")).toEqual(["summary_large_image"]);
    expect(tag(head, "twitter:title")).toEqual(["Quests | EFT Toolset"]);
    expect(tag(head, "twitter:image")).toEqual(["https://www.eft-toolset.com/home-og-image.png"]);
    expect(tag(head, "twitter:image:width")).toEqual(["1200"]);
  });

  it("keeps a page's own Twitter images, and resolves canonical and robots", () => {
    const head = pageHead({
      page: {
        alternates: { canonical: "/item/salewa-first-aid-kit" },
        robots: { index: false, follow: true },
        openGraph: { ...ROOT_METADATA.openGraph, images: [{ url: "https://assets.tarkov.dev/x.webp" }] },
        twitter: { card: "summary", images: ["https://assets.tarkov.dev/y.webp"] },
      },
    });
    expect(head.links).toContainEqual({ rel: "canonical", href: "https://www.eft-toolset.com/item/salewa-first-aid-kit" });
    expect(tag(head, "robots")).toEqual(["noindex, follow"]);
    expect(tag(head, "twitter:image")).toEqual(["https://assets.tarkov.dev/y.webp"]);
  });
});
