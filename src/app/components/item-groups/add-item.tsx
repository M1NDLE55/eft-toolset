import { Dispatch, SetStateAction } from "react";
import { Plus, CircleMinusIcon } from "lucide-react";
import ItemPreview from "./item-preview";
import { ItemPreview as ItemPreviewType } from "@/app/lib/types/itemGroups";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useItemPreview } from "@/app/lib/cache/hooks";

export default function AddItem({
  item,
  setItem,
  groupItems,
  setGroupItems,
}: {
  item: string;
  setItem: Dispatch<SetStateAction<string>>;
  groupItems: ItemPreviewType[];
  setGroupItems: Dispatch<SetStateAction<ItemPreviewType[]>>;
}) {
  const { gridImageLink, loading } = useItemPreview(item);

  const isItemInGroup = groupItems.find((gItem) => gItem.name === item)
    ? true
    : false;

  return (
    <div>
      <h2 className="uppercase tracking-widest text-xs font-bold text-muted-foreground">Add item</h2>
      {(loading || (!gridImageLink && item)) && (
        <div className="border p-4 flex flex-row gap-4">
          <Skeleton className="h-16 w-16" />
          <Skeleton className="w-full p-2" />
        </div>
      )}
      {gridImageLink && item && (
        <ItemPreview item={item} src={gridImageLink}>
          <Button
            variant={"default"}
            disabled={isItemInGroup}
            onClick={() => {
              setGroupItems((groupItems) =>
                groupItems.find((gItem) => gItem.name === item)
                  ? groupItems
                  : [
                      ...groupItems,
                      {
                        name: item,
                        gridImageLink: gridImageLink,
                      },
                    ]
              );
              setItem("");
            }}
          >
            {isItemInGroup ? <CircleMinusIcon /> : <Plus />}
          </Button>
        </ItemPreview>
      )}
    </div>
  );
}
