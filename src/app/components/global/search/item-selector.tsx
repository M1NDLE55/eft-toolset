import { Button } from "@/components/ui/button";
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
        <h2 className="text-lg">Select Item</h2>
        {filteredItems.length > 0 ? (
          <div className="max-h-[200px] overflow-y-auto rounded-md border">
            {filteredItems.slice(0, 19).map((item, i) => (
              <Button
                key={item.name + i}
                variant={"ghost"}
                className="block w-full text-left"
                onClick={() => handleSelect(item.name)}
              >
                {item.name}
              </Button>
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
