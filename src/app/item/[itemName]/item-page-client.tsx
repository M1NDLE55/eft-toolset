"use client";

import { useEffect } from "react";
import LoadingSkeleton from "@/app/components/item/loading-skeleton";
import GenericDetails from "@/app/components/item/generic-details";
import { BartersUsing, CraftsUsing, UsedInTasks } from "@/app/components/item/item-relations";
import SimpleError from "@/app/components/global/error/simple-error";
import { useItem } from "@/app/lib/cache/hooks";
import { addScoutedItem } from "@/app/lib/scouted-items/store";
import { Button } from "@/components/ui/button";

export function ItemPageClient({ itemName }: { itemName: string }) {
  const { item, loading, error, refresh, stale } = useItem(itemName);
  useEffect(() => {
    if (!item) return;
    try {
      addScoutedItem({ name: item.name, gridImageLink: item.gridImageLink });
    } catch {
      return;
    }
  }, [item]);

  if (loading) return <LoadingSkeleton />;
  if (error && !item) {
    return (
      <SimpleError>
        <span>Item data is temporarily unavailable.</span>
        <Button variant="outline" onClick={() => void refresh().catch(() => undefined)}>
          Retry
        </Button>
      </SimpleError>
    );
  }
  if (!item) {
    return <SimpleError>No item named &ldquo;{itemName}&rdquo; was found.</SimpleError>;
  }

  return (
    <article className="flex flex-col gap-5">
      {stale && (
        <p role="status" className="border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Showing saved data while fresh prices load.
        </p>
      )}
      <GenericDetails item={item} />
      <UsedInTasks tasks={item.usedInTasks} />
      <BartersUsing barters={item.bartersUsing} />
      <CraftsUsing crafts={item.craftsUsing} />
    </article>
  );
}
