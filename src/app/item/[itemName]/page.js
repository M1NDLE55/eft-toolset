"use client";

import { GraphQLV2, itemDataQuery } from "@/app/lib/GraphQL";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import UsedInTasks from "@/app/components/item/UsedInTasks";
import LoadingSkeleton from "@/app/components/item/LoadingSkeleton";
import { createItem, getParam } from "@/app/components/item/functions";
import GenericDetails from "@/app/components/item/GenericDetails";
import BartersUsing from "@/app/components/item/BartersUsing";
import CraftsUsing from "@/app/components/item/CraftsUsing";
import { useParams } from "next/navigation";

export default function Page() {
  const { itemName } = getParam(useParams());
  const [data, setData] = useState();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      const d = await GraphQLV2(itemDataQuery, { name: itemName });
      setData(d);
      setIsLoading(false);
    }

    fetchData();
  }, []);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (data.errors) {
    return (
      <div className="bg-red-200 border-red-700 border rounded-md p-3 flex flex-row gap-2">
        <AlertTriangle className="text-red-700" />
        <div className="flex flex-col gap-2">
          {data.errors.map((error, i) => (
            <p className="text-red-700" key={error.message + `${i}`}>
              {error.message}
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="bg-red-200 border-red-700 border rounded-md p-3 flex flex-row gap-2">
        <AlertTriangle className="text-red-700" />
        <div className="flex flex-col gap-2">
          <p className="text-red-700">
            The item &quot;{itemName}&quot; wasn&apos;t found
          </p>
        </div>
      </div>
    );
  }

  const dataItem = data.items[0];
  const item = createItem(dataItem, itemName);

  return (
    <div className="flex flex-col gap-4 text-white">
      <h1 className="absolute -top-10 -left-10">{itemName}</h1>
      <GenericDetails item={item} itemName={itemName} />
      <UsedInTasks tasks={item.usedInTasks} />
      <BartersUsing barters={item.bartersUsing} />
      <CraftsUsing crafts={item.craftsUsing} />
    </div>
  );
}
