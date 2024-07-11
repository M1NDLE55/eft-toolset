"use client";

import { useSearchParams, usePathname } from "next/navigation";
import { useState, Suspense } from "react";
import SearchBar from "../components/scanner/SearchBar";
import ItemSelection from "../components/scanner/ItemSelection";
import SelectedItem from "../components/scanner/SelectedItem";

function Item({ setItemSearch, filteredItems, setFilteredItems, pathname }) {
  const searchParams = useSearchParams();

  return (
    <>
      <ItemSelection
        setItemSearch={setItemSearch}
        filteredItems={filteredItems}
        searchParams={searchParams}
        setFilteredItems={setFilteredItems}
        pathname={pathname}
      />
      <SelectedItem searchParams={searchParams} />
    </>
  );
}

export default function Page() {
  const pathname = usePathname();
  const [filteredItems, setFilteredItems] = useState(null);
  const [itemSearch, setItemSearch] = useState("");

  return (
    <main className="flex justify-center items-center p-4">
      <div className="max-w-xl w-full flex flex-col gap-4">
        <SearchBar
          itemSearch={itemSearch}
          setItemSearch={setItemSearch}
          setFilteredItems={setFilteredItems}
          pathname={pathname}
        />
        <Suspense>
          <Item
            setItemSearch={setItemSearch}
            filteredItems={filteredItems}
            setFilteredItems={setFilteredItems}
            pathname={pathname}
          />
        </Suspense>
      </div>
    </main>
  );
}
