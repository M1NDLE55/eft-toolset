import { describe, expect, it } from "vitest";
import { planThumbnail } from "@/app/lib/raid-planner/thumbnail";

const config = { transform: [1, 0, 1, 0] as [number, number, number, number], coordinateRotation: 0 };
const waypoint = (x: number, z: number) => ({ id: `${x},${z}`, position: { x, z } });

describe("planThumbnail", () => {
  it("returns null for a plan with nothing drawn", () => {
    expect(planThumbnail({ route: [], drawings: [], notes: [] }, config, 320, 180)).toBeNull();
  });

  it("fits the route inside the box and keeps north up", () => {
    const thumbnail = planThumbnail(
      { route: [waypoint(0, 0), waypoint(1000, 500)], drawings: [], notes: [] },
      config,
      320,
      180
    )!;
    const [start, end] = thumbnail.waypoints;
    for (const point of thumbnail.waypoints) {
      expect(point.x).toBeGreaterThanOrEqual(10);
      expect(point.x).toBeLessThanOrEqual(310);
      expect(point.y).toBeGreaterThanOrEqual(10);
      expect(point.y).toBeLessThanOrEqual(170);
    }
    expect(end.x).toBeGreaterThan(start.x);
    // A larger z is further up the map, so further up the box.
    expect(end.y).toBeLessThan(start.y);
    expect(thumbnail.route).toBe(`${start.x},${start.y} ${end.x},${end.y}`);
  });

  it("turns the plan with the map's rotation", () => {
    const thumbnail = planThumbnail(
      { route: [waypoint(0, 0), waypoint(1000, 500)], drawings: [], notes: [] },
      { ...config, coordinateRotation: 180 },
      320,
      180
    )!;
    const [start, end] = thumbnail.waypoints;
    expect(end.x).toBeLessThan(start.x);
    expect(end.y).toBeGreaterThan(start.y);
  });

  it("centres a lone note instead of dividing by zero", () => {
    const thumbnail = planThumbnail(
      { route: [], drawings: [], notes: [{ id: "n", position: { x: 5, z: 5 }, title: "", body: "", color: "#c8b384" }] },
      config,
      320,
      180
    )!;
    expect(thumbnail.notes).toEqual([{ x: 160, y: 90, color: "#c8b384" }]);
    expect(thumbnail.route).toBe("");
  });
});
