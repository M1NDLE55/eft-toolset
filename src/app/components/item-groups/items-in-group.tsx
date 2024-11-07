import ItemPreview from "./item-preview";
import { ItemPreview as ItemPreviewType } from "@/app/lib/types/itemGroups";
import { Button } from "@/components/ui/button";
import { Trash } from "lucide-react";
import { Dispatch, SetStateAction } from "react";

export default function ItemsInGroup({
  groupItems,
  setGroupItems,
}: {
  groupItems: ItemPreviewType[];
  setGroupItems: Dispatch<SetStateAction<ItemPreviewType[]>>;
}) {
  return (
    <div>
      <h2 className="text-lg">Items in group</h2>
      <div className="flex flex-col gap-2">
        {groupItems.map((item) => (
          <ItemPreview
            key={item.name}
            item={item.name}
            src={item.gridImageLink!}
          >
            <Button
              variant={"destructive"}
              onClick={() =>
                setGroupItems((gItems) =>
                  gItems.filter((gItem) => gItem.name !== item.name)
                )
              }
            >
              <Trash />
            </Button>
          </ItemPreview>
        ))}
      </div>
    </div>
  );
}
