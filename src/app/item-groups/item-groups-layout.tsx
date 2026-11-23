import { ReactNode } from "react";
import type { Metadata } from "@/app/lib/seo/metadata";

export const ITEM_GROUPS_LAYOUT_METADATA: Metadata = {
  title: "Item groups",
  description: "Create local Escape from Tarkov item watchlists and compare current prices.",
  alternates: { canonical: "/item-groups" },
  openGraph: {
    title: "Item groups | EFT Toolset",
    description: "Create local Escape from Tarkov item watchlists and compare current prices.",
    url: "/item-groups",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Item groups | EFT Toolset",
    description: "Create local Escape from Tarkov item watchlists and compare current prices.",
    images: ["/home-og-image.png"],
  },
};

export function ItemGroupsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 justify-center p-4 pb-10 min-w-0">
      {children}
    </main>
  );
}
