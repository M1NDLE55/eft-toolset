import { describe, expect, it } from "vitest";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import {
  findPlace,
  isInArea,
  lockAreas,
  matchColor,
  matchPlace,
  nearestPlace,
  placesOf,
  planArea,
  spawnZoneName,
  spawnZones,
} from "@/app/lib/raid-planner/resolve";
import type { MapDetails, MapLock } from "@/app/lib/types/raidPlanner";

const customs = mapConfigs.find((config) => config.key === "customs")!;

const at = (x: number, z: number, y = 1) => ({ x, y, z });
const extract = (name: string, faction: "pmc" | "scav" | "shared", x: number, z: number) => ({
  id: name + faction,
  name,
  faction,
  position: at(x, z),
  outline: [],
  top: null,
  bottom: null,
});
const lock = (keyName: string, x: number, z: number, y = 1): MapLock => ({
  lockType: "door",
  needsPower: false,
  position: at(x, z, y),
  keyName,
});

function details(overrides: Partial<MapDetails> = {}): MapDetails {
  return {
    key: "customs",
    players: null,
    raidDuration: null,
    extracts: [
      extract("Crossroads", "scav", -330, -95),
      extract("Crossroads", "pmc", -335, -90),
      extract("Smugglers' Boat", "pmc", -20, 130),
      extract("Smugglers' Bunker (ZB-1012)", "pmc", 480, -80),
      extract("Dorms V-Ex", "pmc", 240, 160),
      extract("ZB-1011", "pmc", 620, -100),
      extract("ZB-1013", "pmc", 200, -150),
    ],
    transits: [],
    spawns: [
      { zoneName: "ZoneScavBase", zoneLabel: "Stronghold", kind: "scav", position: at(210, -20) },
      { zoneName: "ZoneScavBase", zoneLabel: "Stronghold", kind: "scav", position: at(230, -30) },
      { zoneName: "ZoneBrige", kind: "scav", position: at(14, 86) },
      { zoneName: "0327c5d1-cc7f-432f-92dc-f95fb4719f1b", kind: "pmc", position: at(-310, -95) },
      { zoneName: "0327c5d1-cc7f-432f-92dc-f95fb4719f1c", kind: "pmc", position: at(-300, -90) },
      { zoneName: null, kind: "pmc", position: at(-210, -140) },
    ],
    locks: [
      lock("Dorm room 314 marked key", 181, 184, 6.8),
      lock("Dorm room 206 key", 231, 139),
      lock("Dorm guard desk key", 226, 138),
      lock("Portable cabin key", -251, -222),
      lock("Portable bunkhouse key", 203, 12),
      lock("USEC stash key", 569, -51),
      lock("USEC stash key", 563, -59),
      lock("Gas station storage room key", 415, 36),
      lock("Gas station office key", 416, 39),
    ],
    hazards: [],
    lootContainers: [],
    switches: [],
    stationaryWeapons: [],
    ...overrides,
  };
}

describe("place names", () => {
  const places = placesOf(details());
  const resolve = (name: string) => {
    const result = matchPlace(places, name);
    return "error" in result ? result.error : `${result.place.name} (${result.place.kind}) ${result.match}`;
  };

  it("ignores case, apostrophes, hyphens, spacing, and plurals", () => {
    expect(resolve("Smugglers Boat")).toBe("Smugglers' Boat (pmc extract) exact");
    expect(resolve("SMUGGLERS’ BOAT")).toBe("Smugglers' Boat (pmc extract) exact");
    expect(resolve("zb1013")).toBe("ZB-1013 (pmc extract) exact");
    expect(resolve("dorm v ex")).toBe("Dorms V-Ex (pmc extract) exact");
    expect(resolve("the Smugglers Boat extract")).toBe("Smugglers' Boat (pmc extract) exact");
  });

  it("prefers the PMC side of an extract and lists the other places with the name", () => {
    const result = matchPlace(places, "crossroads");
    expect(result).toMatchObject({ place: { kind: "pmc extract" }, match: "exact" });
    expect("others" in result && result.others.map((place) => place.kind)).toEqual(["scav extract"]);
  });

  it("resolves areas derived from key locks before a longer extract name", () => {
    expect(resolve("Dorms")).toBe("Dorm (area) exact");
    expect(findPlace(places, "Dorms").derived).toBe("centre of 3 Dorm key locks");
  });

  it("calls out partial matches and accepts small typos", () => {
    expect(resolve("dorm room 314")).toBe("Dorm room 314 marked key (door lock) partial");
    expect(resolve("crosroads")).toBe("Crossroads (pmc extract) typo");
    expect(resolve("Stronghlod")).toBe("Stronghold (scav spawn) typo");
    expect(resolve("bridge")).toBe("Brige (scav spawn) typo");
  });

  it("lists candidates for ambiguous names and suggestions for close misses", () => {
    expect(resolve("ZB")).toBe(
      `"ZB" matches several places: ZB-1011 (pmc extract); ZB-1013 (pmc extract); Smugglers' Bunker (ZB-1012) (pmc extract). Use the full name.`
    );
    expect(resolve("smuglers")).toBe(
      `No place is named "smuglers". Did you mean Smugglers' Boat (pmc extract); Smugglers' Bunker (ZB-1012) (pmc extract)?`
    );
    expect(resolve("Big Red")).toBe('No place is named "Big Red".');
    expect(() => findPlace(places, "Big Red")).toThrow(/get_map_details/);
  });

  it("places named spawn zones at their centre, using tarkov.dev's English zone names", () => {
    expect(findPlace(places, "Stronghold").position).toMatchObject({ x: 220, z: -25 });
    expect(spawnZoneName("ZoneOldAZS")).toBe("Old AZS");
    expect(spawnZoneName("BotZoneFloor1")).toBe("Floor1");
    expect(spawnZoneName("ZoneScavBase", "Stronghold")).toBe("Stronghold");
    expect(spawnZoneName("0327c5d1-cc7f-432f-92dc-f95fb4719f1b")).toBeNull();
  });

  it("names the level of a nearby place off the ground floor", () => {
    expect(nearestPlace(places, { x: 181, z: 185 }, customs)).toBe("Dorm room 314 marked key (door lock, 1 m, 3rd Floor)");
    expect(nearestPlace(places, { x: -20, z: 131 }, customs)).toBe("Smugglers' Boat (pmc extract, 1 m)");
  });
});

describe("key-lock areas", () => {
  it("needs three keys, or two sharing two words, close together", () => {
    expect(lockAreas(details()).map((area) => area.name)).toEqual(["Dorm", "Gas station"]);
    const spread = details({ locks: [lock("Dorm a key", 0, 0), lock("Dorm b key", 0, 200), lock("Dorm c key", 0, 400)] });
    expect(lockAreas(spread)).toEqual([]);
  });
});

describe("spawn zones", () => {
  it("names unnamed clusters after the nearest landmark and merges those by the same one", () => {
    const zones = spawnZones(customs, details());
    expect(zones.find((zone) => zone.zone === "Stronghold")).toMatchObject({ kind: "scav", points: 2, x: 220, z: -25 });
    expect(zones.filter((zone) => zone.kind === "pmc")).toEqual([
      expect.objectContaining({ zone: null, near: "Crossroads", points: 3, level: "Ground" }),
    ]);
  });
});

describe("plan checks", () => {
  it("bounds plans by the map and its data with a margin", () => {
    const area = planArea(customs, details());
    expect(isInArea(area, { x: 0, z: 0 })).toBe(true);
    expect(isInArea(area, { x: 750, z: 250 })).toBe(true);
    expect(isInArea(area, { x: 99_999, z: -99_999 })).toBe(false);
    expect(isInArea(planArea(customs, null), { x: 99_999, z: 0 })).toBe(false);
  });

  it("falls back to a default colour with a warning", () => {
    expect(matchColor("Blue", "#d46b6b")).toEqual({ color: "#78b6d2" });
    expect(matchColor(undefined, "#d46b6b")).toEqual({ color: "#d46b6b" });
    expect(matchColor("purple", "#d46b6b")).toEqual({
      color: "#d46b6b",
      warning: 'Colour "purple" is not available, so red was used. Colours: tan, green, orange, red, blue, white.',
    });
  });
});
