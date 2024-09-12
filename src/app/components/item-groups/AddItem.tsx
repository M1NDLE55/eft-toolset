import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { GraphQLV2, itemPreviewQuery } from "@/app/lib/GraphQL";
import { Plus, CircleMinusIcon } from "lucide-react";
import { Data, Item } from "./types";
import ItemPreview from "./ItemPreview";

export default function AddItem({
  item,
  setItem,
  groupItems,
  setGroupItems,
}: {
  item: string;
  setItem: Dispatch<SetStateAction<string>>;
  groupItems: Item[];
  setGroupItems: Dispatch<SetStateAction<Item[]>>;
}) {
  const [data, setData] = useState<Data | null>(null);
  const isItemInGroup = groupItems.find((gItem) => gItem.name === item)
    ? true
    : false;

  useEffect(() => {
    async function fetchData() {
      setData(null);

      const d = (await GraphQLV2(itemPreviewQuery, { name: item })) as Data;

      setData(d);
    }

    fetchData();
  }, [item]);

  return (
    <div>
      <h2 className="text-lg text-neutral-200">Add item</h2>
      {!data ? (
        <div className="animate-pulse bg-neutral-700 rounded-md p-3">
          <div className="w-full p-2 bg-neutral-500 mb-2 rounded-md"></div>
          <div className="w-full p-2 bg-neutral-500 rounded-md"></div>
        </div>
      ) : data?.errors ? (
        <div>{data.errors[0].message}</div>
      ) : (
        <ItemPreview item={item} src={data.items[0].gridImageLink}>
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
                        gridImageLink: data.items[0].gridImageLink,
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
