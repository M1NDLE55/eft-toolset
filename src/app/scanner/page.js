"use client";

import { useSearchParams, usePathname } from "next/navigation";
import { useState, Suspense } from "react";
import SearchBar from "../components/scanner/SearchBar";
import ItemSelection from "../components/scanner/ItemSelection";
import SelectedItem from "../components/scanner/SelectedItem";

export default function Page() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [itemSearch, setItemSearch] = useState("");
  const [filteredItems, setFilteredItems] = useState(null);

  return (
    <Suspense>
      <main className="flex justify-center items-center p-4">
        <div className="max-w-xl w-full flex flex-col gap-4">
          <SearchBar
            itemSearch={itemSearch}
            setItemSearch={setItemSearch}
            setFilteredItems={setFilteredItems}
            pathname={pathname}
          />
          <ItemSelection
            setItemSearch={setItemSearch}
            filteredItems={filteredItems}
            searchParams={searchParams}
            setFilteredItems={setFilteredItems}
            pathname={pathname}
          />
          <SelectedItem searchParams={searchParams} />
        </div>
      </main>
    </Suspense>
  );
}
