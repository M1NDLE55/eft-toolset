"use client";

import UsedInTasks from "@/app/components/item/used-in-tasks";
import LoadingSkeleton from "@/app/components/item/loading-skeleton";
import { getParam } from "@/app/lib/params";
import GenericDetails from "@/app/components/item/generic-details";
import BartersUsing from "@/app/components/item/barters-using";
import CraftsUsing from "@/app/components/item/crafts-using";
import { useParams } from "next/navigation";
import SimpleError from "@/app/components/global/error/simple-error";
import { useItem } from "@/app/lib/cache/hooks";
import { addScoutedItem } from "@/app/components/item/scouted-items";
import { useEffect } from "react";

export default function Page() {
  const { itemName } = getParam(useParams());
  const { item, loading } = useItem(itemName);

  useEffect(() => {
    if (item) {
      addScoutedItem({ name: item.name, gridImageLink: item.gridImageLink });
    }
  }, [item]);

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (!item) {
    return (
      <SimpleError>
        The item &quot;{itemName}&quot; wasn&apos;t found
      </SimpleError>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <GenericDetails item={item} />
      <UsedInTasks tasks={item.usedInTasks} />
      <BartersUsing barters={item.bartersUsing} />
      <CraftsUsing crafts={item.craftsUsing} />
    </div>
  );
}
