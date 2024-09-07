"use client";

import SearchBar from "./SearchBar";
import ItemSelector from "./ItemSelector";
import { useState } from "react";
import { Item } from "./types";

export default function SearchWrapper({
  handleSelect,
  params = null,
}: {
  handleSelect: (itemName: string) => void;
  params?: { itemName: string } | null;
}) {
  const [filteredItems, setFilteredItems] = useState<Item[] | null>(null);
  const [itemSearch, setItemSearch] = useState("");

  return (
    <>
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
    </>
  );
}
