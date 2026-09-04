import { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Raid planner",
  description: "Plan Escape From Tarkov raids on clean interactive maps",
  alternates: { canonical: "/raid-planner" },
  openGraph: {
    title: "Raid planner | EFT Toolset",
    description: "Plan Escape From Tarkov raids on clean interactive maps.",
    url: "/raid-planner",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Raid planner | EFT Toolset",
    description: "Plan Escape From Tarkov raids on clean interactive maps.",
    images: ["/home-og-image.png"],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <main className="min-w-0">{children}</main>;
}
