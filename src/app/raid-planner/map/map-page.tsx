import { preload } from "react-dom";
import type { Metadata } from "@/app/lib/seo/metadata";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { MapViewer } from "@/app/components/raid-planner/map-viewer";
import { MapGuide, MapGuideStrip } from "@/app/components/raid-planner/map-guide";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { mapFaq, type MapGuide as Guide, type MapGuideFacts } from "@/app/lib/seo/map";

/** A raid-planner map page: the interactive map, then its written guide (read on the server, PVP data). */
export interface MapPageData {
  mapKey: string;
  facts: MapGuideFacts;
  guide: Guide;
  metadata: Metadata;
}

export function MapPage({ data: { mapKey, facts, guide } }: { data: MapPageData }) {
  const config = getMapConfig(mapKey)!;
  if (config.svgPath) preload(config.svgPath, { as: "fetch", crossOrigin: "anonymous" });
  const faq = mapFaq(config.name, facts, guide);
  return (
    <>
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: "Raid planner", path: "/raid-planner" },
          { name: `${config.name} map`, path: `/raid-planner/map/${config.key}` },
        ])}
      />
      <MapViewer mapKey={config.key} withGuide />
      <MapGuideStrip config={config} />
      {faq.length > 0 && <JsonLd data={faqPage(faq)} />}
      <MapGuide config={config} details={facts} guide={guide} faq={faq} />
    </>
  );
}
