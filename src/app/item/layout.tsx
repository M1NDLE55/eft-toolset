"use client";

import SearchItem from "../components/item/search/search-item";
import ScoutedSidebar from "../components/item/scouted-items";
import { ReactNode } from "react";

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
