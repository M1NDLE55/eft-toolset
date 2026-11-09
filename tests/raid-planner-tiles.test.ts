import { describe, expect, it } from "vitest";
import { createMapTileLayer, isTileInGrid } from "@/app/lib/raid-planner/tiles";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";

describe("raid planner tile grid", () => {
  const grid = { "2": [4, 4] as [number, number], "3": [8, 6] as [number, number] };

  it("accepts tiles inside the measured grid", () => {
    expect(isTileInGrid(grid, { x: 0, y: 0, z: 2 })).toBe(true);
    expect(isTileInGrid(grid, { x: 3, y: 3, z: 2 })).toBe(true);
    expect(isTileInGrid(grid, { x: 7, y: 5, z: 3 })).toBe(true);
  });

  it("rejects edge tiles past the grid and negative indices", () => {
    expect(isTileInGrid(grid, { x: 4, y: 0, z: 2 })).toBe(false);
    expect(isTileInGrid(grid, { x: 0, y: 4, z: 2 })).toBe(false);
    expect(isTileInGrid(grid, { x: 7, y: 6, z: 3 })).toBe(false);
    expect(isTileInGrid(grid, { x: -1, y: 0, z: 2 })).toBe(false);
  });

  it("falls back to Leaflet bounds for zooms or maps without a grid", () => {
    expect(isTileInGrid(grid, { x: 40, y: 40, z: 6 })).toBe(true);
    expect(isTileInGrid(undefined, { x: 40, y: 40, z: 6 })).toBe(true);
  });

  it("ships a grid for every zoom of every tiled map", () => {
    for (const config of mapConfigs.filter((entry) => entry.strategy === "tile")) {
      for (let zoom = config.minZoom; zoom <= config.maxZoom; zoom += 1) {
        const size = config.tileGrid?.[String(zoom)];
        expect(size, `${config.key} z${zoom}`).toBeDefined();
        expect(size![0]).toBeGreaterThan(0);
        expect(size![1]).toBeGreaterThan(0);
      }
    }
  });

  it("filters out-of-grid tiles in the Leaflet layer", () => {
    const config = mapConfigs.find((entry) => entry.key === "customs")!;
    const layer = createMapTileLayer(config, config.tilePath!) as unknown as {
      _isValidTile: (coords: { x: number; y: number; z: number }) => boolean;
    };
    expect(layer._isValidTile({ x: 4, y: 1, z: 2 })).toBe(false);
  });
});
