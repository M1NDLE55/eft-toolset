import Link from "next/link";

export default function ItemSelection({
  setItemSearch,
  filteredItems,
  setFilteredItems,
  pathname,
}) {
  function createQueryString(name, value) {
    const params = new URLSearchParams();
    params.set(name, value);
    return params.toString();
  }

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
