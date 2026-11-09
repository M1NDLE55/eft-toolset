import type { ReactNode } from "react";
import type { Metadata } from "next";
import ScoutedSidebar from "@/app/components/item/scouted-items";
import { ItemScannerSearch } from "@/app/components/item/item-scanner-search";

export const metadata: Metadata = {
  title: "Item database",
  description: "Find Escape from Tarkov item prices, trader offers, tasks, barters, and crafts.",
  openGraph: {
    title: "Item database | EFT Toolset",
    description: "Find Escape from Tarkov item prices, trader offers, tasks, barters, and crafts.",
    url: "/item",
    images: [{ url: "/item-scanner-og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Item database | EFT Toolset",
    description: "Find Escape from Tarkov item prices, trader offers, tasks, barters, and crafts.",
    images: ["/item-scanner-og.png"],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1">
      <div className="hidden lg:flex">
        <ScoutedSidebar />
      </div>
      <main className="flex min-w-0 flex-1 justify-center px-4 pb-8">
        <div className="flex w-full max-w-2xl flex-col gap-5">
          <div className="sticky top-0 z-30 -mx-4 bg-background/95 px-4 pb-3 pt-4 backdrop-blur supports-backdrop-filter:bg-background/80">
            <ItemScannerSearch />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
