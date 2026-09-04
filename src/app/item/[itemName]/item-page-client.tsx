"use client";

import { useEffect, useState } from "react";
import UsedInTasks from "@/app/components/item/used-in-tasks";
import LoadingSkeleton from "@/app/components/item/loading-skeleton";
import GenericDetails from "@/app/components/item/generic-details";
import BartersUsing from "@/app/components/item/barters-using";
import CraftsUsing from "@/app/components/item/crafts-using";
import SimpleError from "@/app/components/global/error/simple-error";
import { useItem } from "@/app/lib/cache/hooks";
import { addScoutedItem } from "@/app/components/item/scouted-items";
import { Button } from "@/components/ui/button";

export function ItemPageClient({ itemName }: { itemName: string }) {
  const { item, loading, error, refresh, stale } = useItem(itemName);
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    if (!item) return;
    try {
      addScoutedItem({ name: item.name, gridImageLink: item.gridImageLink });
      setStorageError("");
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : "Could not update recent items.");
    }
  }, [item]);

  if (loading) return <LoadingSkeleton />;
  if (error && !item) {
    return (
      <SimpleError>
        <span>Item data is temporarily unavailable.</span>
        <Button variant="outline" onClick={() => void refresh()}>Retry</Button>
      </SimpleError>
    );
  }
  if (!item) {
    return <SimpleError>The item &quot;{itemName}&quot; wasn&apos;t found</SimpleError>;
  }

  return (
    <div className="flex flex-col gap-4">
      {(stale || storageError) && (
        <p role="status" className="border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-200">
          {storageError || "Showing saved data while fresh prices are loaded."}
        </p>
      )}
      <GenericDetails item={item} />
      <UsedInTasks tasks={item.usedInTasks} />
      <BartersUsing barters={item.bartersUsing} />
      <CraftsUsing crafts={item.craftsUsing} />
    </div>
  );
}
