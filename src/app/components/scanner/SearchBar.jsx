import { useEffect, useState } from "react";
import GraphQL from "@/app/features/data/GraphQL";
import { allItemsQuery } from "@/app/features/data/Queries";

export default function SearchBar({
  itemSearch,
  setItemSearch,
  setFilteredItems,
}) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    async function fetchData() {
      try {
        const data = (await GraphQL(allItemsQuery)).data;
        setItems(data.items);
      } catch {
        console.log("Error on items load");
      }
    }

    fetchData();
  }, []);

  return (
    <div>
      <h2 className="text-lg text-white">Search</h2>
      <input
        className="w-full p-2 rounded-md"
        placeholder="Enter item name"
        value={itemSearch}
        onClick={(e) => e.target.select()}
        onChange={(e) => {
          setItemSearch(e.target.value);

          const itemParam = e.target.value.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );
          setFilteredItems(() => {
            if (!itemParam) {
              return null;
            }

            return items.filter((item) =>
              new RegExp(itemParam, "i").test(item.name)
            );
          });
        }}
      ></input>
    </div>
  );
}
