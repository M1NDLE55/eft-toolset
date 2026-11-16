import { describe, expect, it } from "vitest";
import {
  SPAWN_AREA_PADDING_METERS,
  spawnAreas,
  spawnZoneName,
} from "@/app/lib/raid-planner/spawn-areas";

const spawn = (x: number, z: number, y = 0, zoneName: string | null = null) => ({
  position: { x, y, z },
  zoneName,
});

describe("raid planner spawn areas", () => {
  it("groups nearby spawn points and keeps distant ones apart", () => {
    const areas = spawnAreas([spawn(0, 0), spawn(10, 0), spawn(18, 5), spawn(200, 200)]);
    expect(areas.map((area) => area.count).sort()).toEqual([1, 3]);
  });

  it("keeps points on different floors in separate areas", () => {
    const areas = spawnAreas([spawn(0, 0, 0), spawn(2, 0, 8)]);
    expect(areas).toHaveLength(2);
    expect(areas.map((area) => [area.bottom, area.top])).toEqual([
      [0, 0],
      [8, 8],
    ]);
  });

  it("outlines every point with room to spare", () => {
    const [area] = spawnAreas([spawn(0, 0), spawn(15, 0), spawn(5, 12)]);
    const xs = area.outline.map((point) => point.x);
    const zs = area.outline.map((point) => point.z);
    expect(Math.min(...xs)).toBeCloseTo(-SPAWN_AREA_PADDING_METERS, 5);
    expect(Math.max(...xs)).toBeCloseTo(15 + SPAWN_AREA_PADDING_METERS, 5);
    expect(Math.max(...zs)).toBeGreaterThan(12);
    expect(area.centre).toEqual({ x: 20 / 3, y: 0, z: 4 });
  });

  it("names an area after its most common readable zone", () => {
    const [area] = spawnAreas([
      spawn(0, 0, 0, "ZoneOldAZS"),
      spawn(5, 0, 0, "ZoneOldAZS"),
      spawn(9, 0, 0, "ZoneCrossRoad"),
      spawn(3, 3, 0, "0327c5d1-cc7f-432f-92dc-f95fb4719f1b"),
    ]);
    expect(area.zone).toBe("Old AZS");
    expect(spawnAreas([spawn(0, 0)])[0].zone).toBeNull();
    expect(spawnZoneName("ZoneScavBase", "Stronghold")).toBe("Stronghold");
  });
});
