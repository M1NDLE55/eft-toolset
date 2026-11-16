import type { ReactNode } from "react";
import type { Metadata } from "next";
import { RAID_PLANNER_TITLE, RAID_PLANNER_DESCRIPTION } from "@/app/lib/seo/site-copy";
import { preconnect } from "react-dom";

const MAP_ASSET_ORIGIN = "https://assets.tarkov.dev";

export const metadata: Metadata = {
  title: "Raid planner",
  description: RAID_PLANNER_DESCRIPTION,
  alternates: { canonical: "/raid-planner" },
  openGraph: {
    title: `${RAID_PLANNER_TITLE} | EFT Toolset`,
    description: RAID_PLANNER_DESCRIPTION,
    url: "/raid-planner",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${RAID_PLANNER_TITLE} | EFT Toolset`,
    description: RAID_PLANNER_DESCRIPTION,
    images: ["/home-og-image.png"],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  preconnect(MAP_ASSET_ORIGIN);
  preconnect(MAP_ASSET_ORIGIN, { crossOrigin: "anonymous" });
  return <main className="min-w-0">{children}</main>;
}
