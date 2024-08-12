import { useEffect, useState } from "react";
import { GraphQLV2, allItemsQuery } from "@/app/lib/GraphQL";
import { LoaderCircle } from "lucide-react";
import { useParams } from "next/navigation";

export default function SearchBar({
  itemSearch,
  setItemSearch,
  setFilteredItems,
}) {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const params = useParams();

  useEffect(() => {
    async function fetchData() {
      if (!isLoading) {
        setIsLoading(true);
      }

      const data = await GraphQLV2(allItemsQuery);

      if (data.errors) {
        console.error(data.errors);
        alert("Couldn't load items. Please refresh the page.");
        return;
      }

      const allItems = data.items.filter(
        (item, i, array) =>
          i === array.findIndex((tempItem) => tempItem.name === item.name)
      );

      setItems(allItems);
      setIsLoading(false);
    }

    fetchData();
  }, []);

  useEffect(() => {
    if (params.itemName && itemSearch !== "") {
      setItemSearch("");
    }
  }, [params]);

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
          name="search"
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
