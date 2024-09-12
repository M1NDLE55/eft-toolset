import ItemPreview from "./ItemPreview";
import { Item } from "./types";
import { Trash } from "lucide-react";
import { Dispatch, SetStateAction } from "react";

export default function ItemsInGroup({
  groupItems,
  setGroupItems,
}: {
  groupItems: Item[];
  setGroupItems: Dispatch<SetStateAction<Item[]>>;
}) {
  return (
    <div>
      <h2 className="text-neutral-200 text-lg">Items in group</h2>
      <div className="flex flex-col gap-2">
        {groupItems.map((item) => (
          <ItemPreview
            key={item.name}
            item={item.name}
            src={item.gridImageLink}
          >
            <button
              className="p-3 rounded-md bg-red-500"
              onClick={() =>
                setGroupItems((gItems) =>
                  gItems.filter((gItem) => gItem.name !== item.name)
                )
              }
            >
              <Trash />
            </button>
          </ItemPreview>
        ))}
      </div>
    </div>
  );
}
