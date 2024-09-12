import {
  ChangeEvent,
  Dispatch,
  SetStateAction,
  useEffect,
  useState,
} from "react";
import { LoaderCircle } from "lucide-react";
import { Item } from "./types";

export default function SearchBar({
  itemSearch,
  setItemSearch,
  setFilteredItems,
  params = null,
}: {
  itemSearch: string;
  setItemSearch: Dispatch<SetStateAction<string>>;
  setFilteredItems: Dispatch<SetStateAction<Item[] | null>>;
  params?: { itemName: string } | null;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [example, setExample] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    function getItems() {
      if (localStorage.getItem("items")) {
        const items = JSON.parse(localStorage.getItem("items") as string);

        if (!params?.itemName) {
          setExample(
            `e.g., ${
              items[Math.round(Math.random() * (items.length - 1))].name
            }`
          );
        }

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
    if (params?.itemName && itemSearch !== "") {
      setItemSearch("");
    }
  }, [params]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setItemSearch(e.target.value);
    setExample("");

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
    <div className="relative">
      <input
        name="search"
        className="w-full p-2 rounded-md"
        disabled={isLoading}
        placeholder={
          isLoading ? "Loading items..." : `Enter item name ${example}`
        }
        value={itemSearch}
        onClick={(e) => (e.target as HTMLInputElement).select()}
        onChange={handleChange}
      ></input>
      {isLoading && (
        <LoaderCircle className="absolute right-2 top-2 animate-spin text-white" />
      )}
    </div>
  );
}
