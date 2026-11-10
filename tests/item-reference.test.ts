import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "@/app/lib/cache/types";
import { indexCatalog, matchItemReference, resolveItemReference } from "@/app/lib/search/item-reference";

const entry = (name: string, shortName: string | null, slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")): CatalogEntry => [
  `id-${slug}`,
  name,
  shortName,
  null,
  slug,
];

const index = indexCatalog([
  entry("Physical Bitcoin", "0.2BTC"),
  entry("Left half of a Physical Bitcoin", "BTC"),
  entry("Right half of a Physical Bitcoin", "BTC"),
  entry("TerraGroup Labs keycard (Red)", "Red"),
  entry("26x75mm flare cartridge (Red)", "Red"),
  entry("RSP-30 reactive signal cartridge (Red)", "Red"),
  entry("Reprogrammed keycard for A.P.'s apartment lock (Red)", "A.P. Red"),
  entry("5.56x45mm M855", "M855"),
  entry("5.56x45mm M855 ammo pack (50 pcs)", "M855"),
  entry("5.56x45mm M855A1", "M855A1"),
  entry("7.62x39mm PS gzh", "PS"),
  entry("5.45x39mm PS gs", "PS"),
  entry("5.45x39mm PS gs ammo pack (30 pcs)", "PS"),
  entry("Graphics card", "GPU"),
  entry("LEDX Skin Transilluminator", "LEDX"),
  entry("Injector case", "Injectors"),
  entry("Morphine injector", "Morphine"),
]);

describe("item reference matching", () => {
  it("resolves ids, slugs, names, unique short names, and item URLs exactly", () => {
    expect(matchItemReference(index, "id-graphics-card")).toMatchObject({ status: "found", matchedBy: "id" });
    expect(matchItemReference(index, "graphics-card")).toMatchObject({ status: "found", matchedBy: "slug" });
    expect(matchItemReference(index, "physical bitcoin")).toMatchObject({ status: "found", matchedBy: "name" });
    expect(matchItemReference(index, "ledx")).toMatchObject({
      status: "found",
      matchedBy: "shortName",
      item: { name: "LEDX Skin Transilluminator" },
    });
    expect(matchItemReference(index, "https://example.com/item/graphics-card?x=1")).toMatchObject({ matchedBy: "slug" });
  });

  it("resolves a shared short name to the item its holders are parts or packs of, and says so", () => {
    const btc = matchItemReference(index, "btc");
    expect(btc).toMatchObject({ status: "found", matchedBy: "search", item: { name: "Physical Bitcoin" } });
    expect(btc.status === "found" && btc.assumed).toMatch(/Left half of a Physical Bitcoin.*chose Physical Bitcoin/);
    expect(matchItemReference(index, "m855")).toMatchObject({
      status: "found",
      matchedBy: "shortName",
      item: { name: "5.56x45mm M855" },
      assumed: expect.stringContaining("ammo pack"),
    });
    expect(matchItemReference(index, "bitcoin")).toMatchObject({ status: "found", item: { name: "Physical Bitcoin" } });
  });

  it("declines to pick between unrelated items that share a short name or tie on one word", () => {
    expect(matchItemReference(index, "red")).toEqual({
      status: "ambiguous",
      candidates: ["TerraGroup Labs keycard (Red)", "26x75mm flare cartridge (Red)", "RSP-30 reactive signal cartridge (Red)"],
    });
    expect(matchItemReference(index, "ps")).toEqual({
      status: "ambiguous",
      // The round with ammo packs heads a family, so it comes first.
      candidates: ["5.45x39mm PS gs", "7.62x39mm PS gzh"],
    });
    // One word found inside many distinct items names none of them.
    const injectors = indexCatalog(
      ["Injector case", "Morphine injector", "Meldonin injector", "Adrenaline injector"].map((name) => entry(name, null))
    );
    expect(matchItemReference(injectors, "injector")).toMatchObject({ status: "ambiguous", candidates: expect.arrayContaining(["Injector case"]) });
    expect(matchItemReference(injectors, "morphine")).toMatchObject({ status: "found", item: { name: "Morphine injector" } });
    // Even when one of them ranks higher by starting with the word.
    const folders = indexCatalog(
      ["Folder with intelligence on Norvinsk region facilities", "Intelligence folder", "Decrypted intelligence folder"].map(
        (name) => entry(name, null)
      )
    );
    expect(matchItemReference(folders, "folder")).toEqual({
      status: "ambiguous",
      candidates: ["Folder with intelligence on Norvinsk region facilities", "Intelligence folder"],
    });
    expect(matchItemReference(folders, "norvinsk")).toMatchObject({ status: "found", item: { name: expect.stringMatching(/^Folder/) } });
    // Several words narrow it down: take the best-ranked match and list the rest.
    expect(matchItemReference(index, "red keycard")).toMatchObject({
      status: "found",
      matchedBy: "search",
      item: { name: "TerraGroup Labs keycard (Red)" },
      alternatives: ["Reprogrammed keycard for A.P.'s apartment lock (Red)"],
    });
    // The compatibility wrapper still returns one item for older callers.
    expect(resolveItemReference(index, "red")).toMatchObject({ matchedBy: "search", item: { name: "TerraGroup Labs keycard (Red)" } });
  });

  it("lists the weapons a shared short name most plausibly means, not only the parts that carry it", () => {
    const guns = indexCatalog([
      entry("Mosin Rifle 7.62x54R 5-round magazine", "Mosin"),
      entry("Mosin Rifle Tacfire pistol grip", "Mosin"),
      entry("Mosin Rifle AIM Sports Recoil Pad", "Recoil pad"),
      entry("Mosin 7.62x54R bolt-action rifle (Sniper)", "Mosin Sniper"),
      entry("Mosin 7.62x54R bolt-action rifle (Sniper) Default", "Mosin Sniper Default"),
      entry("Mosin 7.62x54R bolt-action rifle (Sniper) Obrez", "Mosin Sniper Obrez"),
      entry("Mosin 7.62x54R bolt-action rifle (Sniper) Obrez M", "Mosin Sniper Obrez M"),
      entry("Mosin 7.62x54R bolt-action rifle (Infantry)", "Mosin Infantry"),
      entry("Mosin 7.62x54R bolt-action rifle (Infantry) Default", "Mosin Infantry Default"),
      entry("SVD 7.62x54R 10-round magazine", "SVD"),
      entry("SVD 7.62x54R 20-round magazine", "SVD"),
      entry("SVDS 7.62x54R sniper rifle", "SVDS"),
      entry("SVDS 7.62x54R sniper rifle Default", "SVDS Default"),
      entry("Car first aid kit", "Car"),
      entry("Folding car key", "Car"),
      entry("TKPD 9.3x64 carbine", "TKPD"),
      entry("TKPD 9.3x64 carbine Assault", "TKPD Assault"),
    ]);
    expect(matchItemReference(guns, "Mosin")).toEqual({
      status: "ambiguous",
      candidates: [
        "Mosin 7.62x54R bolt-action rifle (Sniper)",
        "Mosin 7.62x54R bolt-action rifle (Infantry)",
        "Mosin Rifle 7.62x54R 5-round magazine",
        "Mosin Rifle Tacfire pistol grip",
      ],
    });
    expect(matchItemReference(guns, "svd")).toEqual({
      status: "ambiguous",
      candidates: ["SVDS 7.62x54R sniper rifle", "SVD 7.62x54R 10-round magazine", "SVD 7.62x54R 20-round magazine"],
    });
    // A word that only starts a longer word ("car" in "carbine") does not add the weapon.
    expect(matchItemReference(guns, "car")).toEqual({ status: "ambiguous", candidates: ["Car first aid kit", "Folding car key"] });
  });

  it("matches typos as fuzzy and suggests names for references it cannot match", () => {
    expect(matchItemReference(index, "graphics crad")).toMatchObject({
      status: "found",
      matchedBy: "fuzzy",
      item: { name: "Graphics card" },
    });
    expect(matchItemReference(index, "graphics zzzz")).toEqual({ status: "none", suggestions: ["Graphics card"] });
    expect(matchItemReference(index, "zzzzqqq")).toEqual({ status: "none", suggestions: [] });
    expect(matchItemReference(index, "   ")).toEqual({ status: "none", suggestions: [] });
  });
});
