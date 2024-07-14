"use client";

import { usePathname } from "next/navigation";
import { useState, Suspense } from "react";
import SearchBar from "./SearchBar";
import ItemSelection from "./ItemSelection";
import SelectedItem from "./SelectedItem";

export default function Scanner() {
  const pathname = usePathname();
  const [filteredItems, setFilteredItems] = useState(null);
  const [itemSearch, setItemSearch] = useState("");

  return (
    <main className="flex justify-center p-4 min-h-[calc(100vh-128px)]">
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
          setFilteredItems={setFilteredItems}
          pathname={pathname}
        />
        <Suspense>
          <SelectedItem />
        </Suspense>
      </div>
    </main>
  );
}
