import { describe, expect, it } from "vitest";
import L from "leaflet";
import {
  gameToLatLng,
  getMapBounds,
  getMapCRS,
  getScaledBounds,
  latLngToGame,
} from "@/app/lib/raid-planner/coords";
import type { MapConfig } from "@/app/lib/raid-planner/types";

describe("raid planner coordinates", () => {
  it("round-trips game points and rotated CRS projections", () => {
    expect(latLngToGame(L.latLng(gameToLatLng({ x: 12, z: -7 })))).toEqual({ x: 12, z: -7 });
    const config = {
      transform: [0.5, 10, 0.5, -20],
      coordinateRotation: 180,
    } as MapConfig;
    const crs = getMapCRS(config);
    const point = L.latLng(-7, 12);
    const projection = (crs as unknown as {
      projection: { project: (value: L.LatLng) => L.Point; unproject: (value: L.Point) => L.LatLng };
    }).projection;
    const projected = projection.project(point);
    const restored = projection.unproject(projected);
    expect(restored.lat).toBeCloseTo(point.lat);
    expect(restored.lng).toBeCloseTo(point.lng);
  });

  it("converts and scales configured bounds around their center", () => {
    const bounds: [[number, number], [number, number]] = [[0, 10], [20, 30]];
    expect(getMapBounds(bounds).getSouthWest()).toMatchObject({ lat: 10, lng: 0 });
    const scaled = getScaledBounds(bounds, 2);
    expect(scaled.getSouthWest()).toMatchObject({ lat: 0, lng: -10 });
    expect(scaled.getNorthEast()).toMatchObject({ lat: 40, lng: 30 });
  });
});
