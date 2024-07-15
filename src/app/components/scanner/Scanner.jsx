"use client";

import { usePathname } from "next/navigation";
import { useState, Suspense } from "react";
import SearchBar from "./SearchBar";
import ItemSelection from "./ItemSelection";
import SelectedItem from "./SelectedItem";

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="rounded-md bg-neutral-700 h-[84px]"></div>
      <div
        className={`grid grid-cols-1 sm:grid-cols-2
         gap-4`}
      >
        <div className="flex-1 bg-neutral-700 h-[84px] rounded-md"></div>
        <div className="flex-1 bg-neutral-700 h-[84px] rounded-md"></div>
      </div>
      <div className="rounded-md bg-neutral-700 h-[84px]"></div>
    </div>
  );
}

export default function Scanner() {
  const pathname = usePathname();
  const [filteredItems, setFilteredItems] = useState(null);
  const [itemSearch, setItemSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [item, setItem] = useState(null);
  const [errors, setErrors] = useState(null);

  function handleSelect(itemName) {
    setItemSearch(itemName);
    setFilteredItems(null);
    setItem(null);
    setErrors(null);
    setIsLoading(true);
  }

  return (
    <main className="flex justify-center p-4 min-h-[calc(100vh-128px)]">
      <div className="max-w-xl w-full flex flex-col gap-4">
        <SearchBar
          itemSearch={itemSearch}
          setItemSearch={setItemSearch}
          setFilteredItems={setFilteredItems}
        />
        <ItemSelection
          handleSelect={handleSelect}
          filteredItems={filteredItems}
          pathname={pathname}
        />
        {isLoading && <LoadingSkeleton />}
        <Suspense>
          <SelectedItem
            isLoading={isLoading}
            setIsLoading={setIsLoading}
            item={item}
            setItem={setItem}
            errors={errors}
            setErrors={setErrors}
          />
        </Suspense>
      </div>
    </main>
  );
}
