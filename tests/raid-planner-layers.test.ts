import { describe, expect, it } from "vitest";
import { getDefaultLayers, getLayerGroups } from "@/app/lib/raid-planner/layer-options";
import { mapConfigs, getMapConfig } from "@/app/lib/raid-planner/maps-config";
import type { MapDetails } from "@/app/lib/types/raidPlanner";

const at = (x: number, z: number) => ({ x, y: 0, z });

const details = (overrides: Partial<MapDetails> = {}): MapDetails => ({
  key: "customs",
  players: null,
  raidDuration: null,
  extracts: [
    { id: "a", name: "Crossroads", faction: "pmc", position: at(0, 0), outline: [], top: null, bottom: null },
  ],
  transits: [],
  spawns: [{ kind: "pmc", position: at(1, 1), zoneName: null } as MapDetails["spawns"][number]],
  locks: [],
  hazards: [],
  lootContainers: [],
  switches: [],
  stationaryWeapons: [],
  ...overrides,
});

describe("raid planner default layers", () => {
  it("shows place names, PMC extracts and PMC spawns that the map has", () => {
    const customs = getMapConfig("customs")!;
    expect(getDefaultLayers(customs, details())).toEqual(["labels", "extracts:pmc", "spawns:pmc"]);
  });

  it("keeps every default except unavailable place names before details load", () => {
    expect(getDefaultLayers({ labels: [] }, null)).toEqual([
      "extracts:pmc",
      "extracts:shared",
      "transits",
      "spawns:pmc",
    ]);
  });

  it("lists place names as a layer only when the map has labels", () => {
    const withLabels = getLayerGroups(details(), getMapConfig("lighthouse")!);
    expect(withLabels[0]).toEqual({
      name: "Map",
      options: [{ id: "labels", label: "Place names", count: getMapConfig("lighthouse")!.labels!.length }],
    });
    expect(getLayerGroups(details()).some((group) => group.name === "Map")).toBe(false);
  });

  it("copies non-empty place names with game coordinates into the map config", () => {
    const labelled = mapConfigs.filter((config) => config.labels?.length);
    expect(labelled.map((config) => config.key)).toContain("lighthouse");
    for (const config of labelled) {
      for (const label of config.labels!) {
        expect(label.text.trim()).not.toBe("");
        expect(label.position).toHaveLength(2);
        expect(label.position.every(Number.isFinite)).toBe(true);
      }
    }
  });
});
