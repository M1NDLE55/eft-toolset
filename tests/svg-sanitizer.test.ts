import { describe, expect, it } from "vitest";
import { parseSafeSvg } from "@/app/lib/raid-planner/sanitize-svg";

describe("SVG sanitization", () => {
  it("removes executable nodes, handlers, external links, and CSS URLs", () => {
    const svg = parseSafeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject><iframe src="https://evil.test" /></foreignObject>
        <a href="https://evil.test"><path onclick="alert(1)" style="fill:url(https://evil.test/x)" /></a>
        <path id="safe" href="#local" style="fill:url(#gradient)" />
        <style>body, .st0 { opacity: 0.5 }</style>
      </svg>
    `);

    expect(svg.querySelector("script, foreignObject, iframe")).toBeNull();
    expect(svg.querySelector("[onclick]")).toBeNull();
    expect(svg.hasAttribute("onload")).toBe(false);
    expect(svg.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(svg.querySelector("path")?.getAttribute("style")).not.toMatch(/url\s*\(/i);
    expect(svg.querySelector("#safe")?.getAttribute("href")).toBe("#local");
    expect(svg.querySelector("#safe")?.getAttribute("style")).toContain("url(#gradient)");
    expect(svg.querySelector("style")?.textContent).toContain("[data-rp-map] body");
  });

  it("rejects non-SVG documents", () => {
    expect(() => parseSafeSvg("<html />")).toThrow(/not an SVG/i);
  });
});
