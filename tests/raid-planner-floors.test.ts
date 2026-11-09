import { describe, expect, it } from "vitest";
import { floorName, getFloorStack } from "@/app/lib/raid-planner/floors";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";

const stack = (key: string) => getFloorStack(getMapConfig(key)!).map((option) => option.name);

describe("raid planner floor stack", () => {
  it("names the Labs base level and orders levels top to bottom", () => {
    expect(stack("the-lab")).toEqual(["2nd Floor", "1st Floor", "Technical"]);
    expect(floorName(getMapConfig("the-lab")!, null)).toBe("1st Floor");
  });

  it("puts underground levels below ground and upper floors above", () => {
    expect(stack("customs")).toEqual(["4th Floor", "3rd Floor", "2nd Floor", "Ground", "Underground"]);
    expect(stack("reserve")).toEqual(["5th Floor", "4th Floor", "3rd Floor", "2nd Floor", "Ground", "Bunkers"]);
    expect(stack("streets-of-tarkov")).toEqual([
      "5th Floor",
      "4th Floor",
      "3rd Floor",
      "2nd Floor",
      "Ground",
      "Underground",
    ]);
    expect(stack("shoreline")).toEqual(["3rd Floor", "2nd Floor", "Ground", "Underground"]);
    expect(stack("factory")).toEqual(["3rd Floor", "2nd Floor", "Ground", "Tunnels"]);
    expect(stack("ground-zero")).toEqual(["3rd Floor", "2nd Floor", "Ground", "Garage"]);
  });

  it("keeps the base level as the only option on single-level maps", () => {
    expect(getFloorStack(getMapConfig("woods")!)).toEqual([{ id: null, name: "Ground" }]);
  });
});
