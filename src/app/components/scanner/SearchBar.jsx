import { useEffect, useState } from "react";
import GraphQL from "@/app/features/data/GraphQL";
import { allItemsQuery } from "@/app/features/data/Queries";
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
      const response = await GraphQL(allItemsQuery);

      if (response.errors) {
        console.error(response.errors);
        alert("Couldn't load items. Please refresh the page.");
        return;
      }

      setItems(response.data.items);
      setIsLoading(false);
    }

    fetchData();
  }, []);

  function handleChange(e) {
    setItemSearch(e.target.value);

    const itemParam = e.target.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setFilteredItems(() => {
      if (!itemParam) {
        return null;
      }

      return items.filter((item) => new RegExp(itemParam, "i").test(item.name));
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
