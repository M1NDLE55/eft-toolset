import { describe, expect, it } from "vitest";
import type { ComposedItem } from "@/app/lib/cache/types";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { itemFaq, itemLabel, itemPageDescription, itemPageTitle } from "@/app/lib/seo/item";
import { buildMapGuide, mapDescription, mapFaq, mapIntro } from "@/app/lib/seo/map";
import { formatRoubles, plural } from "@/app/lib/seo/format";

function item(overrides: Partial<ComposedItem> = {}): ComposedItem {
  return {
    id: "gpu",
    normalizedName: "graphics-card",
    name: "Graphics card",
    shortName: "GPU",
    gridImageLink: null,
    wikiLink: null,
    fleaMarketFee: 20_000,
    width: 2,
    height: 1,
    changeLast48hPercent: 1.5,
    buyFor: [{ vendor: { name: "Flea Market" }, priceRUB: 420_000 }],
    sellFor: [
      { vendor: { name: "Mechanic" }, priceRUB: 250_000 },
      { vendor: { name: "Flea Market" }, priceRUB: 400_000 },
    ],
    usedInTasks: [],
    hideoutRequirements: [],
    hideoutSlots: [],
    bartersUsing: [],
    craftsUsing: [],
    ...overrides,
  };
}

const point = { x: 0, y: 0, z: 0 };

describe("item SEO copy", () => {
  it("adds the short name players search by, when the name doesn't already contain it", () => {
    expect(itemLabel(item())).toBe("Graphics card (GPU)");
    expect(itemLabel(item({ name: "5.56x45mm M995", shortName: "M995" }))).toBe("5.56x45mm M995");
    expect(itemLabel(item({ name: "A very long item name that keeps on going", shortName: "Long" }))).toBe(
      "A very long item name that keeps on going"
    );
    expect(itemPageTitle(item())).toBe("Graphics card (GPU) Price & Uses in Tarkov");
  });

  it("leads the description with the live flea price after fees and the best trader", () => {
    const description = itemPageDescription(item());
    expect(description).toMatch(/^Graphics card sells for 380,000 ₽ on the Tarkov flea market after fees\. Mechanic pays 250,000 ₽\./);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("describes trader-only items without mentioning the flea market", () => {
    const banned = item({ fleaMarketFee: null, fleaBanned: true, sellFor: [{ vendor: { name: "Therapist" }, priceRUB: 9_000 }] });
    expect(itemPageDescription(banned)).toMatch(/^Graphics card sells for 9,000 ₽ to Therapist in Tarkov\./);
    expect(itemFaq(banned)[0].answer).toContain("can't be sold on the flea market");
  });

  it("answers worth, where to sell, keep or sell, and where to buy from the data", () => {
    const faq = itemFaq(
      item({
        hideoutRequirements: [{ station: { name: "Bitcoin farm" }, level: 2, count: 3, foundInRaid: false }],
      })
    );
    expect(faq.map((entry) => entry.question)).toEqual([
      "How much is Graphics card worth in Tarkov?",
      "Where should I sell Graphics card?",
      "Should I keep or sell Graphics card?",
      "Where can I buy Graphics card?",
    ]);
    expect(faq[0].answer).toContain("380,000 ₽ on the flea market");
    expect(faq[0].answer).toContain("190,000 ₽ per slot");
    expect(faq[1].answer).toContain("The best trader is Mechanic at 250,000 ₽");
    expect(faq[2].answer).toContain("3 are needed in total (3 for 1 hideout upgrade)");
    expect(faq[3].answer).toBe("Buy it on the flea market for about 420,000 ₽.");
  });

  it("says an unused item is safe to sell", () => {
    expect(itemFaq(item())[2].answer).toBe("No task, hideout upgrade, barter or craft uses it, so it's safe to sell.");
  });
});

describe("map SEO copy", () => {
  const details: MapDetails = {
    key: "customs",
    players: "10-14",
    raidDuration: 40,
    extracts: [
      { id: "a", name: "ZB-1011", faction: "pmc", position: point, outline: [], top: null, bottom: null },
      { id: "b", name: "Crossroads", faction: "pmc", position: point, outline: [], top: null, bottom: null },
      { id: "b2", name: "Crossroads", faction: "pmc", position: point, outline: [], top: null, bottom: null },
      {
        id: "c",
        name: "Dorms V-Ex",
        faction: "shared",
        position: point,
        outline: [],
        top: null,
        bottom: null,
        transferItem: { name: "Roubles", count: 7000 },
      },
      { id: "d", name: "Old Road Gate", faction: "scav", position: point, outline: [], top: null, bottom: null },
    ],
    transits: [{ id: "t", description: "Transit to Factory", position: point }],
    spawns: [],
    locks: [
      { lockType: "door", needsPower: false, position: point, keyName: "Dorm room 314 marked key", keyNormalizedName: "dorm-room-314-marked-key" },
      { lockType: "door", needsPower: false, position: point, keyName: "Dorm room 314 marked key", keyNormalizedName: "dorm-room-314-marked-key" },
      { lockType: "door", needsPower: true, position: point, keyName: null },
    ],
    hazards: [],
    lootContainers: [],
    switches: [],
    stationaryWeapons: [],
    bosses: [
      { name: "Reshala", spawnChance: 0.38, locations: [], escorts: 4, spawnTimeSeconds: null, trigger: null },
      { name: "Nobody", spawnChance: 0, locations: [], escorts: 0, spawnTimeSeconds: null, trigger: null },
    ],
  };

  it("groups extracts by faction, merges duplicates and counts keys per lock", () => {
    const guide = buildMapGuide(details);
    expect(guide.extracts.pmc.map((extract) => extract.name)).toEqual(["Crossroads", "ZB-1011"]);
    expect(guide.extracts.shared.map((extract) => extract.name)).toEqual(["Dorms V-Ex"]);
    expect(guide.keys).toEqual([{ name: "Dorm room 314 marked key", normalizedName: "dorm-room-314-marked-key", locks: 2 }]);
    expect(guide.keylessLocks).toBe(1);
    expect(guide.powerLocks).toBe(1);
    expect(guide.bosses.map((boss) => boss.name)).toEqual(["Reshala"]);
  });

  it("merges a boss's spawn groups and leaves raiders and infected out of the headline", () => {
    const boss = (name: string, spawnChance: number, zone: string) => ({
      name,
      spawnChance,
      locations: [{ zone, name: zone, chance: 1 }],
      escorts: 0,
      spawnTimeSeconds: null,
      trigger: null,
    });
    const withMobs: MapDetails = {
      ...details,
      bosses: [boss("Infected screamer", 1, "A"), boss("Infected screamer", 1, "B"), boss("Raider", 0.6, "C"), boss("Reshala", 0.38, "D")],
    };
    const guide = buildMapGuide(withMobs);
    expect(guide.bosses.map((entry) => [entry.name, entry.locations.length])).toEqual([
      ["Reshala", 1],
      ["Infected screamer", 2],
      ["Raider", 1],
    ]);
    expect(mapDescription("Customs", withMobs, guide)).toContain(", Reshala spawns,");
    expect(mapFaq("Customs", withMobs, guide)[1].answer).toMatch(/^Reshala \(38% spawn chance\)\./);

    const raidersOnly = { ...details, bosses: [boss("Raider", 0.6, "C")] };
    const raiderGuide = buildMapGuide(raidersOnly);
    expect(mapDescription("The Lab", raidersOnly, raiderGuide)).toContain("Scav extracts, spawns, keys");
    expect(mapFaq("The Lab", raidersOnly, raiderGuide).map((entry) => entry.question)).not.toContain(
      "Which bosses spawn on The Lab?"
    );
  });

  it("writes the intro, description and FAQ from the counts", () => {
    const guide = buildMapGuide(details);
    expect(mapIntro("Customs", details, guide)).toContain(
      "shows 3 PMC extracts, 2 Scav extracts, 1 transit, 1 boss and 1 key"
    );
    expect(mapDescription("Customs", details, guide)).toBe(
      "Interactive Customs map for Escape from Tarkov with all 3 PMC and 2 Scav extracts, Reshala spawns, keys and loot. Plan routes and share them."
    );
    const faq = mapFaq("Customs", details, guide);
    expect(faq[0].answer).toMatch(/^Customs has 3 PMC extracts \(Crossroads, ZB-1011 and Dorms V-Ex\) and 2 Scav extracts\./);
    expect(faq[1].answer).toMatch(/^Reshala \(38% spawn chance\)\./);
    expect(faq[2].answer).toBe("A Customs raid lasts 40 minutes with 10-14 players.");
  });
});

describe("SEO formatting", () => {
  it("formats roubles with plain grouping and pluralises", () => {
    expect(formatRoubles(1234567.4)).toBe("1,234,567 ₽");
    expect(plural(1, "boss", "bosses")).toBe("1 boss");
    expect(plural(2, "boss", "bosses")).toBe("2 bosses");
    expect(plural(2, "key")).toBe("2 keys");
  });
});
