import Link from "next/link";
import { useCallback } from "react";

export default function ItemSelection({
  setItemSearch,
  filteredItems,
  setFilteredItems,
  searchParams,
  pathname,
}) {
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

  return (
    filteredItems && (
      <div>
        <h2 className="text-lg text-white">Select Item</h2>
        <div className="bg-white max-h-[200px] overflow-y-auto rounded-md">
          {filteredItems.slice(0, 19).map((item) => (
            <Link
              key={item.id}
              href={pathname + "?" + createQueryString("item", item.id)}
              className="p-2 hover:bg-neutral-100 block"
              onClick={() => {
                setItemSearch(item.name);
                setFilteredItems(null);
              }}
            >
              {item.name}
            </Link>
          ))}
        </div>
      </div>
    )
  );
}
