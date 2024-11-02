import { AlertTriangle } from "lucide-react";

export default function ItemSelection({
  itemSearch,
  handleSelect,
  filteredItems,
}: {
  itemSearch: string;
  handleSelect: (itemName: string) => void;
  filteredItems: { name: string }[] | null;
}) {
  return (
    filteredItems && (
      <div>
        <h2 className="text-lg text-neutral-200">Select Item</h2>
        {filteredItems.length > 0 ? (
          <div className="bg-white max-h-[200px] overflow-y-auto rounded-md">
            {filteredItems.slice(0, 19).map((item, i) => (
              <button
                key={item.name + i}
                className="p-2 hover:bg-neutral-100 block w-full text-left"
                onClick={() => handleSelect(item.name)}
              >
                {item.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-yellow-200 border-yellow-700 border rounded-md p-3 flex flex-row gap-2">
            <AlertTriangle className="text-yellow-700" />
            <p className="text-yellow-700">
              No item contains the search phrase &quot;{itemSearch}&quot;
            </p>
          </div>
        )}
      </div>
    )
  );
}
