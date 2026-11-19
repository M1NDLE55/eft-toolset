import { describe, expect, it } from "vitest";
import { itemIndexing, itemSitemapEntries, type IndexableItem } from "@/app/lib/seo/item-index";

const item = (id: string, slug: string, name: string, overrides: Partial<IndexableItem> = {}): IndexableItem => ({
  id,
  slug,
  name,
  types: [],
  baseItemId: null,
  traded: false,
  ...overrides,
});

const ITEMS = [
  item("m4", "colt-m4a1-556x45-assault-rifle", "Colt M4A1 5.56x45 assault rifle", { types: ["gun"], traded: true }),
  item("m4d", "colt-m4a1-556x45-assault-rifle-default", "Colt M4A1 5.56x45 assault rifle Default", { types: ["preset"], baseItemId: "m4" }),
  item("m4n", "colt-m4a1-556x45-assault-rifle-2k17-ny", "Colt M4A1 5.56x45 assault rifle 2k17 NY", { types: ["preset"], baseItemId: "m4" }),
  item("case", "twitch-winter-2025-case-epic", "Twitch Winter 2025 case (Epic)", { types: ["noFlea"] }),
  item("case8", "twitch-winter-2025-case-epic-8", "Twitch Winter 2025 case (Epic)", { types: ["noFlea"] }),
  item("case10", "twitch-winter-2025-case-epic-10", "Twitch Winter 2025 case (Epic)", { types: ["noFlea"] }),
  item("tag3", "dogtag-usec-3", "Dogtag USEC", { types: ["barter"] }),
  item("tag15", "dogtag-usec-15", "Dogtag USEC", { types: ["barter"] }),
  item("car", "folding-car-key", "Folding car key", { types: ["keys"] }),
  item("car1", "folding-car-key-1", "Folding car key", { types: ["keys"], traded: true }),
  item("pack", "9x18mm-pm-ppe-gzh-ammo-pack-50-pcs", "9x18mm PM PPe gzh ammo pack (50 pcs)", { types: ["ammoBox"], traded: true }),
  item("pack1", "545x39mm-bp-gs-ammo-pack-120-pcs-1", "5.45x39mm BP gs ammo pack (120 pcs)", { types: ["ammoBox"] }),
  item("pack0", "545x39mm-bp-gs-ammo-pack-120-pcs", "5.45x39mm BP gs ammo pack (120 pcs)", { types: ["ammoBox"] }),
  item("gas", "gas-analyzer", "Gas analyzer", { traded: true }),
];

describe("item indexing", () => {
  const indexing = itemIndexing(ITEMS);

  it("points a weapon's default preset at the weapon, but keeps other presets", () => {
    expect(indexing.get("colt-m4a1-556x45-assault-rifle-default")).toEqual({ kind: "canonical", slug: "colt-m4a1-556x45-assault-rifle", reason: "default-preset" });
    expect(indexing.get("colt-m4a1-556x45-assault-rifle")).toEqual({ kind: "index" });
    expect(indexing.get("colt-m4a1-556x45-assault-rifle-2k17-ny")).toEqual({ kind: "index" });
  });

  it("keeps one page per repeated name, the unnumbered one else the lowest number", () => {
    expect(indexing.get("twitch-winter-2025-case-epic")).toEqual({ kind: "index" });
    expect(indexing.get("twitch-winter-2025-case-epic-8")).toEqual({ kind: "canonical", slug: "twitch-winter-2025-case-epic", reason: "same-name" });
    expect(indexing.get("twitch-winter-2025-case-epic-10")).toEqual({ kind: "canonical", slug: "twitch-winter-2025-case-epic", reason: "same-name" });
    expect(indexing.get("dogtag-usec-3")).toEqual({ kind: "index" });
    expect(indexing.get("dogtag-usec-15")).toEqual({ kind: "canonical", slug: "dogtag-usec-3", reason: "same-name" });
  });

  it("keeps a namesake the flea market prices on its own: it's a different item", () => {
    expect(indexing.get("folding-car-key-1")).toEqual({ kind: "index" });
    expect(indexing.get("folding-car-key")).toEqual({ kind: "index" });
  });

  it("leaves ammo packs out of search, numbered or not, rather than claiming they're the round", () => {
    for (const slug of ["9x18mm-pm-ppe-gzh-ammo-pack-50-pcs", "545x39mm-bp-gs-ammo-pack-120-pcs", "545x39mm-bp-gs-ammo-pack-120-pcs-1"]) {
      expect(indexing.get(slug)).toEqual({ kind: "noindex", reason: "ammo-pack" });
    }
    expect(indexing.get("gas-analyzer")).toEqual({ kind: "index" });
  });

  it("lists only indexed pages in the sitemap, dated by tarkov.dev's update", () => {
    const pages = new Map(Array.from(indexing, ([slug, entry]) => [slug, { indexing: entry, updated: slug === "gas-analyzer" ? "2026-11-19T07:08:14.000Z" : null }]));
    const entries = itemSitemapEntries(pages);
    expect(entries.map((entry) => entry.path).toSorted()).toEqual(
      [
        "/item/colt-m4a1-556x45-assault-rifle",
        "/item/colt-m4a1-556x45-assault-rifle-2k17-ny",
        "/item/dogtag-usec-3",
        "/item/folding-car-key",
        "/item/folding-car-key-1",
        "/item/gas-analyzer",
        "/item/twitch-winter-2025-case-epic",
      ].toSorted()
    );
    expect(entries.find((entry) => entry.path === "/item/gas-analyzer")?.lastModified).toBe("2026-11-19T07:08:14.000Z");
  });
});
