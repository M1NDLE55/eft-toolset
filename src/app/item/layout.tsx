import type { ReactNode } from "react";
import type { Metadata } from "next";
import ScoutedSidebar from "@/app/components/item/scouted-items";
import { ItemScannerSearch } from "@/app/components/item/item-scanner-search";
import { ITEM_HUB_DESCRIPTION, ITEM_HUB_TITLE } from "@/app/lib/seo/site-copy";

export const metadata: Metadata = {
  title: ITEM_HUB_TITLE,
  description: ITEM_HUB_DESCRIPTION,
  openGraph: {
    title: `${ITEM_HUB_TITLE} | EFT Toolset`,
    description: ITEM_HUB_DESCRIPTION,
    url: "/item",
    images: [{ url: "/item-scanner-og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${ITEM_HUB_TITLE} | EFT Toolset`,
    description: ITEM_HUB_DESCRIPTION,
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
        {/* Item pages lay cards out across the width; the price hub keeps its own narrower column. */}
        <div className="flex w-full max-w-[1760px] flex-col gap-4">
          <div className="sticky top-0 z-30 -mx-4 bg-background/95 px-4 pb-2 pt-4 backdrop-blur supports-backdrop-filter:bg-background/80">
            <div className="mx-auto w-full max-w-2xl">
              <ItemScannerSearch />
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
