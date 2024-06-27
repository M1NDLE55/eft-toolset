"use client";

import Link from "next/link";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useState, useEffect } from "react";
import GraphQL from "../features/data/GraphQL"; //- production
// import GraphQL from "../temp/ItemList"; //- testing

export default function Page() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [itemSearch, setItemSearch] = useState("");
  const [items, setItems] = useState([]);
  const [currentItem, setCurrentItem] = useState({});
  const [filteredItems, setFilteredItems] = useState([]);

  const allitemQuery = `{
    items (limit: 5) {
          id
          name
    }
  }`;

  const currentItemQuery = (id) => `{
    item (id: "${id}") {
          name
          fleaMarketFee
          buyFor{
            vendor {
              name
            }
            price
          }         
          sellFor{
            vendor {
              name
            }
            price
          }         
    }
  }`;

  useEffect(() => {
    async function fetchData() {
      try {
        const data = (await GraphQL(allitemQuery)).data;
        setItems(data.items);
      } catch {
        console.log("Error on items load");
      }
    }

    fetchData();
  }, []);

  const createQueryString = useCallback(
    (name, value) => {
      const params = new URLSearchParams(searchParams);

      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }

      return params.toString();
    },
    [searchParams]
  );

  useEffect(() => {
    async function fetchCurrentItem() {
      const id = searchParams.get("item");

      if (!id) {
        setCurrentItem({});
        return;
      }

      try {
        const data = (await GraphQL(currentItemQuery(id))).data;
        setCurrentItem(data.item);
      } catch {
        console.log("Error on current item load");
        setCurrentItem({});
      }
    }

    fetchCurrentItem();
  }, [searchParams]);

  return (
    <main className="flex justify-center items-center p-4">
      <div className="max-w-2xl w-full flex flex-col gap-4">
        <div>
          <h2 className="text-lg text-white">Search</h2>
          <input
            className="w-full p-2 rounded-md"
            placeholder="Enter item name"
            value={itemSearch}
            onClick={(e) => e.target.select()}
            onChange={(e) => {
              const itemParam = e.target.value.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
              );

              setItemSearch(itemParam);

              setFilteredItems(() => {
                if (!itemParam) {
                  router.replace(pathname);
                  return [];
                }

                return items.filter((item) =>
                  new RegExp(itemParam, "i").test(item.name)
                );
              });
            }}
          ></input>
          {filteredItems.length > 0 && (
            <>
              <h2 className="mt-2 text-lg text-white">Suggestions</h2>
              <div className="bg-white max-h-[200px] overflow-y-auto rounded-md">
                {filteredItems.slice(0, 19).map((item) => (
                  <Link
                    key={item.id}
                    href={pathname + "?" + createQueryString("item", item.id)}
                    className="p-2 hover:bg-neutral-100 block"
                  >
                    {item.name}
                  </Link>
                ))}
              </div>
            </>
          )}

          {currentItem && (
            <>
              <h2 className="mt-2 text-lg text-white">Item</h2>
              <div className="text-white">{JSON.stringify(currentItem)}</div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
