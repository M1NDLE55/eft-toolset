"use client";

import { useEffect, useState } from "react";
import LoadingSkeleton from "@/app/components/item/loading-skeleton";
import GenericDetails from "@/app/components/item/generic-details";
import { BartersUsing, CraftsUsing, HideoutUses, UsedInTasks } from "@/app/components/item/item-relations";
import SimpleError from "@/app/components/global/error/simple-error";
import { primeItem, useItem } from "@/app/lib/cache/hooks";
import type { ItemReference } from "@/app/lib/cache/fetcher";
import type { ComposedItem } from "@/app/lib/cache/types";
import type { GameMode } from "@/components/game-mode/mode";
import { addScoutedItem } from "@/app/lib/scouted-items/store";
import { Button } from "@/components/ui/button";
import { PriceTrend } from "@/app/components/item/price-trend";
import { bestSell } from "@/app/lib/item-price";
import { summarizeNeeds } from "@/app/lib/item-needs";
import { recordPrices, usePriceHistories } from "@/app/lib/price-history";
import { useGameMode } from "@/components/game-mode/context";

export function ItemPageClient({
  reference,
  initial,
}: {
  reference: ItemReference;
  initial: { gameMode: GameMode; item: ComposedItem; renderedAt: number } | null;
}) {
  useState(() => {
    if (initial && typeof window !== "undefined") primeItem(reference, initial.gameMode, initial.item, initial.renderedAt);
    return null;
  });
  const query = useItem(reference);
  const { gameMode, hydrated } = useGameMode();
  const serverItem = initial && !query.item && (!hydrated || initial.gameMode === gameMode) ? initial.item : null;
  const item = query.item ?? serverItem;
  const { error, refresh, stale } = query;
  const loading = query.loading && !item;
  const itemName = reference.name ?? reference.slug;
  const [now] = useState(() => Date.now());
  const history = usePriceHistories(gameMode, item ? [item.name] : [], hydrated);
  const liveItem = query.item;
  const livePrice = liveItem ? (bestSell(liveItem)?.price ?? null) : null;

  useEffect(() => {
    if (liveItem && livePrice !== null) void recordPrices(gameMode, [{ name: liveItem.name, price: livePrice }]);
  }, [gameMode, liveItem, livePrice]);

  useEffect(() => {
    if (!item) return;
    try {
      addScoutedItem({ name: item.name, gridImageLink: item.gridImageLink, normalizedName: item.normalizedName || null });
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
  const needs = summarizeNeeds(item);

  return (
    <article className="flex flex-col gap-5">
      {stale && (
        <p role="status" className="border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Showing saved data while fresh prices load.
        </p>
      )}
      <GenericDetails item={item} />
      {liveItem && livePrice !== null && <PriceTrend points={history(liveItem.name)} price={livePrice} now={now} />}
      {needs && (
        <p className="border border-[#3a3326] bg-[#1a1610] px-3 py-2 text-sm text-[#c8b384]">
          Needed: {needs.summary}
        </p>
      )}
      <UsedInTasks tasks={item.usedInTasks} />
      <HideoutUses requirements={item.hideoutRequirements} slots={item.hideoutSlots} />
      <BartersUsing barters={item.bartersUsing} />
      <CraftsUsing crafts={item.craftsUsing} />
    </article>
  );
}
