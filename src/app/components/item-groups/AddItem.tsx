import { Dispatch, SetStateAction } from "react";
import { Plus, CircleMinusIcon } from "lucide-react";
import ItemPreview from "./ItemPreview";
import { useQuery } from "@apollo/client";
import { ITEM_PREVIEW } from "@/app/lib/queries";
import { ItemPreview as ItemPreviewType } from "@/app/lib/types/itemGroups";
import QueryError from "../global/error/query-error";

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
      <h2 className="text-lg text-neutral-200">Add item</h2>
      {loading && (
        <div className="animate-pulse bg-neutral-700 rounded-md p-3">
          <div className="w-full p-2 bg-neutral-500 mb-2 rounded-md"></div>
          <div className="w-full p-2 bg-neutral-500 rounded-md"></div>
        </div>
      )}
      {(error || !data) && <QueryError error={error} />}
      {data && (
        <ItemPreview item={item} src={data.items[0]!.gridImageLink!}>
          <button
            className={`p-3 rounded-md ${
              isItemInGroup ? "bg-neutral-500" : "bg-green-500"
            }`}
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
          </button>
        </ItemPreview>
      )}
    </div>
  );
}
