import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { getMapConfig, mapConfigs } from "@/app/lib/raid-planner/maps-config";
import { MapViewer } from "@/app/components/raid-planner/map-viewer";

interface MapPageProps {
  params: Promise<{ map: string }>;
}

export function generateStaticParams() {
  return mapConfigs.map((config) => ({ map: config.key }));
}

export async function generateMetadata({ params }: MapPageProps): Promise<Metadata> {
  const map = getMapConfig((await params).map);
  if (!map) return { title: "Map not found", robots: { index: false, follow: false } };
  const description = `Browse the interactive ${map.name} map for Escape from Tarkov: extracts, spawns, keys, loot and more.`;
  return {
    title: `${map.name} map`,
    description,
    alternates: { canonical: `/raid-planner/map/${map.key}` },
    openGraph: {
      title: `${map.name} map | EFT Toolset`,
      description,
      url: `/raid-planner/map/${map.key}`,
      images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${map.name} map | EFT Toolset`,
      description,
      images: ["/home-og-image.png"],
    },
  };
}

export default async function MapPage({ params }: MapPageProps) {
  const config = getMapConfig((await params).map);
  if (!config) notFound();
  if (config.svgPath) preload(config.svgPath, { as: "fetch", crossOrigin: "anonymous" });
  return <MapViewer mapKey={config.key} />;
}
