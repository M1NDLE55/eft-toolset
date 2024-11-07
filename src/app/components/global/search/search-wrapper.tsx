"use client";

import SearchBar from "./search-bar";
import ItemSelector from "./item-selector";
import { useState } from "react";

export default function SearchWrapper({
  handleSelect,
  params = null,
}: {
  handleSelect: (itemName: string) => void;
  params?: { itemName: string } | null;
}) {
  const [filteredItems, setFilteredItems] = useState<{ name: string }[] | null>(
    null
  );
  const [itemSearch, setItemSearch] = useState("");

  return (
    <div>
      <h2 className="text-lg">Search item</h2>
      <div className="flex flex-col gap-4">
        <SearchBar
          itemSearch={itemSearch}
          setItemSearch={setItemSearch}
          setFilteredItems={setFilteredItems}
          params={params}
        />
        <ItemSelector
          itemSearch={itemSearch}
          handleSelect={(itemName) => {
            handleSelect(itemName);
            setItemSearch("");
            setFilteredItems(null);
          }}
          filteredItems={filteredItems}
        />
      </div>
    </div>
  );
}
