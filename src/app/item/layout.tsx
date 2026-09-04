import SearchItem from "../components/item/search/search-item";
import ScoutedSidebar from "../components/item/scouted-items";
import { ReactNode } from "react";
import type { Metadata } from "next";

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
    <div className="flex sm:min-h-[calc(100vh-130px)] min-h-[calc(100vh-65px)]">
      <div className="hidden lg:flex">
        <ScoutedSidebar />
      </div>
      <main className="flex-1 min-w-0 flex justify-center p-4">
        <div className="max-w-xl w-full flex flex-col gap-4">
          <SearchItem />
          {children}
        </div>
      </main>
    </div>
  );
}
