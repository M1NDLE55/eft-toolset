import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CC_BY_NC_SA_4, MapAttribution, SVG_MAP_SOURCE } from "@/app/components/raid-planner/map-chrome";
import { getMapConfig, mapConfigs } from "@/app/lib/raid-planner/maps-config";

function render(element: React.ReactElement) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

describe("map attribution", () => {
  it.each(mapConfigs.filter((config) => config.svgPath).map((config) => config.key))(
    "credits the %s SVG map with author, source, licence and the changes we make",
    (key) => {
      const host = render(<MapAttribution config={getMapConfig(key)!} />);
      const links = Array.from(host.querySelectorAll("a"), (a) => a.getAttribute("href"));
      expect(host.textContent).toContain("Map by Shebuka");
      expect(links).toEqual([SVG_MAP_SOURCE, CC_BY_NC_SA_4]);
      expect(host.querySelector('a[rel~="license"]')?.textContent).toBe("CC BY-NC-SA 4.0");
      expect(host.textContent).toContain("Modified: floor visibility, recoloured");
    }
  );

  it("keeps the tile maps' author credit without a licence claim", () => {
    const customs = getMapConfig("customs")!;
    const host = render(<MapAttribution config={customs} />);
    expect(host.textContent).toContain(`Map by ${customs.author}`);
    expect(host.textContent).not.toContain("CC BY-NC-SA");
    expect(host.textContent).not.toContain("Modified");
  });
});
