"use client";

import ItemSelection from "./ItemSelection";
import SearchBar from "./SearchBar";

import { useState } from "react";

export default function SearchItem() {
  const [filteredItems, setFilteredItems] = useState(null);
  const [itemSearch, setItemSearch] = useState("");

  function handleSelect() {
    setItemSearch("");
    setFilteredItems(null);
  }

  return (
    <>
      <SearchBar
        itemSearch={itemSearch}
        setItemSearch={setItemSearch}
        setFilteredItems={setFilteredItems}
      />
      <ItemSelection
        itemSearch={itemSearch}
        handleSelect={handleSelect}
        filteredItems={filteredItems}
      />
    </>
  );
}
