import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ map: string }>;
}): Promise<Metadata> {
  const key = (await params).map;
  const map = getMapConfig(key);
  if (!map) return { title: "Map not found", robots: { index: false, follow: false } };
  return {
    title: `${map.name} map`,
    description: `Browse the interactive ${map.name} map for Escape from Tarkov.`,
    alternates: { canonical: `/raid-planner/map/${map.key}` },
    openGraph: {
      title: `${map.name} map | EFT Toolset`,
      description: `Browse the interactive ${map.name} map for Escape from Tarkov.`,
      url: `/raid-planner/map/${map.key}`,
      images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${map.name} map | EFT Toolset`,
      description: `Browse the interactive ${map.name} map for Escape from Tarkov.`,
      images: ["/home-og-image.png"],
    },
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
