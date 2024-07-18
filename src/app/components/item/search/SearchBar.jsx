import { useEffect, useState } from "react";
import GraphQL from "@/app/lib/GraphQL";
import { allItemsQuery } from "@/app/lib/Queries";
import { LoaderCircle } from "lucide-react";

export default function SearchBar({
  itemSearch,
  setItemSearch,
  setFilteredItems,
}) {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      if (!isLoading) {
        setIsLoading(true);
      }

      const response = await GraphQL(allItemsQuery);

      if (response.errors) {
        console.error(response.errors);
        alert("Couldn't load items. Please refresh the page.");
        return;
      }

      const allItems = response.data.items.filter(
        (item, i, array) =>
          i === array.findIndex((tempItem) => tempItem.name === item.name)
      );

      setItems(allItems);
      setIsLoading(false);
    }

    fetchData();
  }, []);

  function handleChange(e) {
    setItemSearch(e.target.value);

    const searchPhrase = e.target.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setFilteredItems(() => {
      if (!searchPhrase) {
        return null;
      }

      return items.filter((item) =>
        new RegExp(searchPhrase, "i").test(item.name)
      );
    });
  }

  return (
    <div>
      <h2 className="text-lg text-white">Search</h2>
      <div className="relative">
        <input
          className="w-full p-2 rounded-md"
          disabled={isLoading}
          placeholder={isLoading ? "Loading items..." : "Enter item name"}
          value={itemSearch}
          onClick={(e) => e.target.select()}
          onChange={handleChange}
        ></input>
        {isLoading && (
          <LoaderCircle className="absolute right-2 top-2 animate-spin text-white" />
        )}
      </div>
    </div>
  );
}
