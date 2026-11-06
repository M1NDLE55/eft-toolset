import { describe, expect, it } from "vitest";
import { formatDistance, routeLength } from "@/app/lib/raid-planner/route";

const waypoint = (x: number, z: number) => ({ id: `${x}:${z}`, position: { x, z } });

describe("raid planner route length", () => {
  it("sums the straight legs between waypoints", () => {
    expect(routeLength([])).toBe(0);
    expect(routeLength([waypoint(0, 0)])).toBe(0);
    expect(routeLength([waypoint(0, 0), waypoint(3, 4), waypoint(3, 10)])).toBe(11);
  });

  it("formats meters and kilometers", () => {
    expect(formatDistance(42.4)).toBe("42 m");
    expect(formatDistance(1234)).toBe("1.2 km");
    expect(formatDistance(12_500)).toBe("13 km");
  });
});
