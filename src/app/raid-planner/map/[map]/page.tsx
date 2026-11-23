import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { Suspense, cache } from "react";
import { getMapConfig, mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { MapViewer } from "@/app/components/raid-planner/map-viewer";
import { MapGuide, MapGuideStrip } from "@/app/components/raid-planner/map-guide";
import type { MapConfig } from "@/app/lib/raid-planner/types";
import { JsonLd, breadcrumbList, faqPage } from "@/app/components/seo/json-ld";
import { getMapDetails } from "@/app/lib/api/tarkov-server";
import { readForRender, RenderDataUnavailableError } from "@/app/lib/api/server-render";
import { buildMapGuide, mapDescription, mapFaq } from "@/app/lib/seo/map";
import { mapPageTitle } from "@/app/lib/seo/site-copy";

interface MapPageProps {
  params: Promise<{ map: string }>;
}

// Map guides change with patches. Every map is built with the site.
export const revalidate = 86400;
export const dynamic = "force-static";
export function generateStaticParams() {
  return mapConfigs.map((config) => ({ map: config.key }));
}

// The guide is written in English from the PVP data: extracts, bosses and keys rarely differ by mode.
const loadGuide = cache(async (mapKey: string) => {
  const details = await readForRender("Map page", () => getMapDetails("regular", mapKey));
  if (!details) return undefined;
  return { details, guide: buildMapGuide(details) };
});

export async function generateMetadata({ params }: MapPageProps): Promise<Metadata> {
  const map = getMapConfig((await params).map);
  if (!map) return { title: "Map not found", robots: { index: false, follow: false } };
  const loaded = await loadGuide(map.key);
  const title = mapPageTitle(map.name);
  const description = mapDescription(map.name, loaded?.details, loaded?.guide);
  return {
    title,
    description,
    alternates: { canonical: `/raid-planner/map/${map.key}` },
    openGraph: {
      title: `${title} | EFT Toolset`,
      description,
      url: `/raid-planner/map/${map.key}`,
      images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | EFT Toolset`,
      description,
      images: ["/home-og-image.png"],
    },
  };
}

export default async function MapPage({ params }: MapPageProps) {
  const config = getMapConfig((await params).map);
  if (!config) notFound();
  if (config.svgPath) preload(config.svgPath, { as: "fetch", crossOrigin: "anonymous" });
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
      <Suspense fallback={null}>
        <GuideSection config={config} />
      </Suspense>
    </>
  );
}

async function GuideSection({ config }: { config: MapConfig }) {
  const loaded = await loadGuide(config.key);
  // Fail the render rather than cache the map without its guide.
  if (!loaded) throw new RenderDataUnavailableError("Map guide");
  const faq = mapFaq(config.name, loaded.details, loaded.guide);
  return (
    <>
      {faq.length > 0 && <JsonLd data={faqPage(faq)} />}
      <MapGuide config={config} details={loaded.details} guide={loaded.guide} faq={faq} />
    </>
  );
}
