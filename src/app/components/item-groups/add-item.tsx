import { Dispatch, SetStateAction } from "react";
import { Plus, CircleMinusIcon } from "lucide-react";
import ItemPreview from "./item-preview";
import { useQuery } from "@apollo/client";
import { ITEM_PREVIEW } from "@/app/lib/queries";
import { ItemPreview as ItemPreviewType } from "@/app/lib/types/itemGroups";
import QueryError from "../global/error/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

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
  const { data, loading, error } = useQuery(ITEM_PREVIEW, {
    variables: { name: item },
    skip: !item,
  });

  const isItemInGroup = groupItems.find((gItem) => gItem.name === item)
    ? true
    : false;

  return (
    <div>
      <h2 className="text-lg">Add item</h2>
      {(loading || !data) && (
        <div className="border rounded-md p-4 flex flex-row gap-4">
          <Skeleton className="h-16 w-16" />
          <Skeleton className="w-full p-2" />
        </div>
      )}
      {error && <QueryError error={error} />}
      {data && (
        <ItemPreview item={item} src={data.items[0]!.gridImageLink!}>
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
                        gridImageLink: data.items[0]!.gridImageLink,
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
