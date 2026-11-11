// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ALL_ENTRIES,
  ANCHOR_KINDS,
  findLandmark,
  GLOSSARY,
  GLOSSARY_CATEGORIES,
  landmarkNames,
  landmarkPlaces,
  landmarkPosition,
  listTerms,
  lookupTerm,
} from "@/app/lib/glossary/glossary";
import labels from "@/app/lib/glossary/map-labels.json";
import notes from "@/app/lib/glossary/label-notes.json";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { matchPlace } from "@/app/lib/raid-planner/resolve";
import { nameWords } from "@/app/lib/search/name-match";

const MAP_KEYS = new Set(mapConfigs.map((config) => config.key));

function only(text: string, filter = {}) {
  const result = lookupTerm(text, filter);
  expect(result.entries, `${text}: ${result.match}`).toHaveLength(1);
  return { ...result, entry: result.entries[0] };
}

describe("glossary data", () => {
  it("has a few hundred well-formed entries, each with a source", () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(300);
    const seen = new Set<string>();
    for (const entry of GLOSSARY) {
      const label = `${entry.category}: ${entry.term}`;
      expect(GLOSSARY_CATEGORIES, label).toContain(entry.category);
      expect(entry.meaning.length, label).toBeGreaterThan(10);
      expect(entry.source, label).toMatch(/^https:\/\/[^\s]+$/);
      // The app's own item pages say nothing about what players call an item.
      expect(entry.source, label).not.toContain("eft-toolset.com");
      if (entry.map) expect(MAP_KEYS, label).toContain(entry.map);
      const key = `${entry.category}|${entry.map ?? ""}|${nameWords(entry.term).join("")}`;
      expect(seen.has(key), `duplicate ${label}`).toBe(false);
      seen.add(key);
      expect(new Set(entry.aliases).size, label).toBe(entry.aliases.length);
      expect(entry.itemRefs?.map((item) => item.name) ?? [], label).toEqual(entry.items ?? []);
    }
  });

  it("anchors landmarks to a place in the data, with a position and a confidence", () => {
    const landmarks = GLOSSARY.filter((entry) => entry.category === "landmark");
    expect(landmarks.length).toBeGreaterThanOrEqual(150);
    for (const entry of landmarks) {
      const label = `${entry.map}: ${entry.term}`;
      expect(entry.map, label).toBeDefined();
      expect(entry.at, label).not.toBeUndefined();
      if (entry.at === null) {
        expect(entry.position, label).toBeUndefined();
        expect(entry.confidence, label).toBeNull();
        continue;
      }
      expect(ANCHOR_KINDS, label).toContain(entry.at!.kind);
      expect(["high", "medium", "low"], label).toContain(entry.confidence);
      expect(entry.position, label).toEqual({ x: expect.any(Number), z: expect.any(Number), ...(entry.position?.y !== undefined ? { y: expect.any(Number) } : {}) });
      if (entry.at!.kind === "label") {
        const mapLabels = (labels as Record<string, { name: string; x: number; z: number }[]>)[entry.map!];
        const found = mapLabels.find((candidate) => candidate.name === entry.at!.name);
        expect(found, label).toBeDefined();
        expect(entry.position!.x, label).toBeCloseTo(found!.x, 1);
        expect(entry.position!.z, label).toBeCloseTo(found!.z, 1);
      }
    }
  });

  it("covers the jargon players use most", () => {
    const required: [string, string?][] = [
      ["Big Red", "customs"],
      ["Dorms", "customs"],
      ["New Gas", "customs"],
      ["Old Gas", "customs"],
      ["Fortress", "customs"],
      ["Crackhouse", "customs"],
      ["Resort", "shoreline"],
      ["Pier", "shoreline"],
      ["KIBA", "interchange"],
      ["Goshan", "interchange"],
      ["Ultra", "interchange"],
      ["Sawmill", "woods"],
      ["LEDX"],
      ["Tetris"],
      ["Slick"],
      ["BEAR"],
      ["USEC"],
      ["Salewa"],
      ["GPU"],
      ["Bitcoin"],
      ["M995"],
      ["Killa helmet"],
      ["FIR"],
      ["PMC"],
      ["Scav"],
      ["Flea"],
      ["LL"],
      ["Raid"],
      ["Labs card"],
      ["Insured"],
      ["Wipe"],
      ["Rat"],
      ["Chad"],
      ["Timmy"],
      ["One-tap"],
      ["Head eyes"],
      ["Desync"],
      ["Gamma"],
      ["Kappa"],
      ["Woods boss"],
    ];
    for (const [term, map] of required) {
      const result = lookupTerm(term, map ? { map } : {});
      expect(result.match, term).toBe("exact");
      if (map) expect(result.entries.some((entry) => entry.map === map), term).toBe(true);
    }
  });
});

describe("lookupTerm", () => {
  it("finds a term by name or alias, ignoring case and punctuation, with its place", () => {
    const { entry } = only("big red", { map: "customs" });
    expect(entry).toMatchObject({ term: "Big Red", category: "landmark", map: "customs", confidence: "high" });
    // Big Red is the warehouse with the Tarcone Director's office upstairs.
    const tarcone = GLOSSARY.find((candidate) => candidate.at?.name === "Tarcone Director's office key")!;
    const position = landmarkPosition(entry)!;
    expect(Math.hypot(position.x - tarcone.position!.x, position.z - tarcone.position!.z)).toBeLessThan(30);

    expect(only("Big Red warehouse").entry.term).toBe("Big Red");
    expect(only("woods boss").entry).toMatchObject({ term: "Shturman", category: "boss" });
    expect(only("Tetriz").entry.itemRefs?.[0]).toMatchObject({ name: "Tetriz portable game console" });
  });

  it("returns every entry a shared name could mean", () => {
    const bs = lookupTerm("BS");
    expect(bs.match).toBe("exact");
    expect(bs.entries.map((entry) => entry.term).toSorted()).toEqual(["5.45 BS", "54R BS"]);

    const gasStations = lookupTerm("gas station", { category: "landmark" });
    expect(new Set(gasStations.entries.map((entry) => entry.map)).size).toBeGreaterThan(1);
    const customs = lookupTerm("gas station", { map: "customs" });
    expect(customs.entries.every((entry) => entry.category !== "landmark" || entry.map === "customs")).toBe(true);
  });

  it("tolerates small typos but not in short names", () => {
    expect(lookupTerm("Big Redd")).toMatchObject({ match: "typo", entries: [{ term: "Big Red" }] });
    expect(lookupTerm("Shturmn")).toMatchObject({ match: "typo", entries: [{ term: "Shturman" }] });
    expect(lookupTerm("BX").match).toBe("none");
  });

  it("finds the jargon inside a whole message, in order", () => {
    const result = lookupTerm("Going to loot Big Red then the dorms marked room, any tips vs Reshala?", { map: "customs" });
    expect(result.match).toBe("mentions");
    if (result.match !== "mentions") return;
    expect(result.found).toEqual(["big red", "dorm marked room", "reshala"]);
    expect(result.entries.map((entry) => entry.term)).toEqual(["Big Red", "Marked room", "Reshala"]);
    expect(lookupTerm("ps I love you").match).not.toBe("mentions");
  });

  it("suggests close names when nothing matches", () => {
    const result = lookupTerm("Big Rad House");
    expect(result.match).toBe("none");
    if (result.match === "none") expect(result.suggestions.length).toBeGreaterThan(0);
    expect(lookupTerm("   ")).toEqual({ match: "none", entries: [], suggestions: [] });
  });
});

describe("map labels", () => {
  it("adds tarkov.dev's map labels that no curated entry covers", () => {
    const sniperHill = only("Sniper Hill", { map: "customs" }).entry;
    expect(sniperHill).toMatchObject({ category: "landmark", at: { kind: "label", name: "Sniper Hill" }, source: "https://tarkov.dev/map/customs" });
    expect(ALL_ENTRIES.filter((entry) => entry.map === "customs" && entry.term === "Big Red")).toHaveLength(1);
    expect(listTerms({ map: "customs", category: "landmark" }).length).toBeGreaterThan(30);
  });

  it("describes every label from the map data, and from the wiki where it has a description", () => {
    const fromLabels = ALL_ENTRIES.slice(GLOSSARY.length);
    expect(fromLabels.length).toBeGreaterThan(200);
    for (const entry of fromLabels) {
      const mapName = mapConfigs.find((config) => config.key === entry.map)!.name;
      expect(entry.meaning, entry.term).toContain(`of ${mapName}`);
      expect(entry.source, entry.term).toMatch(/^https:\/\/(escapefromtarkov\.fandom\.com\/wiki\/|tarkov\.dev\/map\/)/);
    }
    // Every note names a label on its map.
    for (const [map, names] of Object.entries(notes as Record<string, Record<string, unknown>>)) {
      for (const name of Object.keys(names)) expect(labels[map as keyof typeof labels].map((label) => label.name), map).toContain(name);
    }

    const streamerHouse = only("Streamer House", { map: "customs" }).entry;
    expect(streamerHouse.source).toBe("https://escapefromtarkov.fandom.com/wiki/USEC_stash_key#Lock_Location");
    expect(streamerHouse.meaning).toMatch(/^Warehouse #6.*In the west of Customs, right by USEC stash\./);
  });
});

describe("landmark places", () => {
  it("resolves a landmark name on its own map only", () => {
    const place = findLandmark("customs", "Big Red")!;
    expect(place).toMatchObject({ kind: "landmark", name: "Big Red" });
    expect(place.derived).toContain("Big Red");
    expect(findLandmark("customs", "big red warehouse")?.name).toBe("Big Red");
    expect(findLandmark("woods", "Big Red")).toBeNull();
    const unplaced = GLOSSARY.find((entry) => entry.category === "landmark" && entry.at === null)!;
    expect(findLandmark(unplaced.map!, unplaced.term)).toBeNull();
  });

  it("matches a landmark by any alias, reporting the landmark itself", () => {
    const names = landmarkNames("customs");
    expect(matchPlace(names, "Paradigm warehouse")).toMatchObject({ match: "exact", place: { name: "Big Red" } });
    expect(matchPlace(names, "Paradigm warehuose")).toMatchObject({ match: "typo", place: { name: "Big Red" } });
    expect(matchPlace(names, "big re")).toMatchObject({ match: "partial", place: { name: "Big Red" } });
  });

  it("lists every placed landmark of a map", () => {
    const places = landmarkPlaces("customs");
    expect(places.map((place) => place.name)).toEqual(expect.arrayContaining(["Big Red", "Dorms", "Sniper Hill"]));
    expect(places.every((place) => Number.isFinite(place.position.x) && Number.isFinite(place.position.z))).toBe(true);
    expect(landmarkPlaces("customs")).toBe(places);
  });
});
