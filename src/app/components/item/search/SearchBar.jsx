import { useEffect, useState } from "react";
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
    function getItems() {
      if (localStorage.getItem("items")) {
        const items = JSON.parse(localStorage.getItem("items"));

        setItems(items);
        setIsLoading(false);
        return;
      }

      setTimeout(getItems, 200);
    }

    if (!isLoading) {
      setIsLoading(true);
    }

    // recursively check if items exist
    getItems();
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
