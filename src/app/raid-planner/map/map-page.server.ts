import { notFound } from "@tanstack/react-router";
import { getMapDetails } from "@/app/lib/api/tarkov-server";
import { requireForRender } from "@/app/lib/api/server-render";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { buildMapGuide, mapDescription, mapGuideFacts } from "@/app/lib/seo/map";
import { mapPageTitle } from "@/app/lib/seo/site-copy";
import type { MapPageData } from "./map-page";

/**
 * A map page. The guide is written in English from the PVP data (extracts, bosses and keys rarely
 * differ by mode); it fails the render rather than cache the map without its guide.
 */
export async function loadMapPage(mapKey: string): Promise<MapPageData> {
  const map = getMapConfig(mapKey);
  if (!map) throw notFound();
  const details = await requireForRender("Map guide", () => getMapDetails("regular", map.key));
  if (!details) throw notFound();
  const guide = buildMapGuide(details);
  const title = mapPageTitle(map.name);
  const description = mapDescription(map.name, details, guide);
  return {
    mapKey: map.key,
    facts: mapGuideFacts(details),
    guide,
    metadata: {
      title,
      description,
      alternates: { canonical: `/raid-planner/map/${map.key}` },
      openGraph: { title: `${title} | EFT Toolset`, description, url: `/raid-planner/map/${map.key}`, images: [{ url: "/home-og-image.png", width: 1200, height: 630 }] },
      twitter: { card: "summary_large_image", title: `${title} | EFT Toolset`, description, images: ["/home-og-image.png"] },
    },
  };
}
