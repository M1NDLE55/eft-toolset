import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function ItemSelection({
  handleSelect,
  filteredItems,
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
        {filteredItems.length > 0 ? (
          <div className="bg-white max-h-[200px] overflow-y-auto rounded-md">
            {filteredItems.slice(0, 19).map((item) => (
              <Link
                key={item.id}
                href={pathname + "?" + createQueryString("item", item.id)}
                className="p-2 hover:bg-neutral-100 block"
                onClick={() => handleSelect(item.name)}
              >
                {item.name}
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-yellow-200 border-yellow-700 border rounded-md p-3 flex flex-row gap-2">
            <AlertTriangle className="text-yellow-700" />
            <p className="text-yellow-700">
              No item contains this search phrase
            </p>
          </div>
        )}
      </div>
    )
  );
}
