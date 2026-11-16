import { describe, expect, it } from "vitest";
import { applySvgFloor, findFloorContainer } from "@/app/lib/raid-planner/map-svg";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg">
  <style>.land { fill: green }</style>
  <defs></defs>
  <g id="Ground_Level"></g>
  <g id="First_Floor"></g>
  <g id="Second_Floor"></g>
</svg>`;

function parse(markup: string) {
  return new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
}

const config = {
  svgLayer: "Ground_Level",
  floors: [
    { id: "2nd-floor", name: "2nd Floor", svgLayer: "First_Floor" },
    { id: "3rd-floor", name: "3rd Floor", svgLayer: "Second_Floor" },
  ],
};

const state = (svg: Element) =>
  Array.from(svg.querySelectorAll("g[id]"), (g) => `${g.id}:${g.getAttribute("class") ?? ""}`);

describe("svg floor visibility", () => {
  it("finds floor groups placed straight under the root after style and defs", () => {
    const svg = parse(SVG);
    expect(findFloorContainer(svg, "Ground_Level")).toBe(svg);
  });

  it("still finds floors wrapped in one extra group", () => {
    const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg"><g id="wrap"><g id="Ground_Level"/><g id="First_Floor"/></g></svg>`);
    expect(findFloorContainer(svg, "Ground_Level")?.id).toBe("wrap");
  });

  it("shows only the ground level when no floor is picked", () => {
    const svg = parse(SVG);
    applySvgFloor(svg, config, null);
    expect(state(svg)).toEqual(["Ground_Level:", "First_Floor:rp-hidden", "Second_Floor:rp-hidden"]);
  });

  it("fades the ground and shows only the picked floor", () => {
    const svg = parse(SVG);
    applySvgFloor(svg, config, "3rd-floor");
    expect(state(svg)).toEqual(["Ground_Level:rp-dimmed", "First_Floor:rp-hidden", "Second_Floor:"]);
    applySvgFloor(svg, config, null);
    expect(state(svg)).toEqual(["Ground_Level:", "First_Floor:rp-hidden", "Second_Floor:rp-hidden"]);
  });
});
