"use client";

import { useEffect, useState } from "react";
import { trackUsage } from "@/app/lib/usage/track";
import LoadingSkeleton from "@/app/components/item/loading-skeleton";
import SimpleError from "@/app/components/global/error/simple-error";
import { primeItem, useItem } from "@/app/lib/cache/hooks";
import type { ItemReference } from "@/app/lib/cache/fetcher";
import type { ComposedItem } from "@/app/lib/cache/types";
import type { GameMode } from "@/components/game-mode/mode";
import { addScoutedItem } from "@/app/lib/scouted-items/store";
import { Button } from "@/components/ui/button";
import { bestSell } from "@/app/lib/item-price";
import { summarizeNeeds } from "@/app/lib/item-needs";
import { recordPrices, usePriceHistories } from "@/app/lib/price-history";
import { useGameMode } from "@/components/game-mode/context";
import type { ItemWiki } from "@/app/lib/wiki/item-wiki";
import { ItemPageView } from "@/app/components/item/item-view";

export function ItemPageClient({
  reference,
  initial,
  wiki,
}: {
  reference: ItemReference;
  initial: { gameMode: GameMode; item: ComposedItem; renderedAt: number; pricesVersion?: number } | null;
  /** The item's wiki page, the same in every game mode; null without one. */
  wiki: ItemWiki | null;
}) {
  useState(() => {
    if (initial && typeof window !== "undefined") primeItem(reference, initial.gameMode, initial.item, initial.renderedAt, initial.pricesVersion);
    return null;
  });
  const query = useItem(reference);
  const { gameMode, hydrated } = useGameMode();
  const serverItem = initial && !query.item && (!hydrated || initial.gameMode === gameMode) ? initial.item : null;
  const item = query.item ?? serverItem;
  const { error, refresh } = query;
  // The server's copy refreshing after a cached page loads isn't saved data: no notice for it.
  const stale = query.stale && query.item !== initial?.item;
  const loading = query.loading && !item;
  const itemName = reference.name ?? reference.slug;
  const [now] = useState(() => Date.now());
  const history = usePriceHistories(gameMode, item ? [item.name] : [], hydrated);
  const liveItem = query.item;
  const livePrice = liveItem ? (bestSell(liveItem)?.price ?? null) : null;

  useEffect(() => {
    if (liveItem && livePrice !== null) void recordPrices(gameMode, [{ name: liveItem.name, price: livePrice }]);
  }, [gameMode, liveItem, livePrice]);

  const itemId = item?.id;
  useEffect(() => {
    if (itemId) trackUsage("item.view", { subject: itemId, gameMode });
  }, [itemId, gameMode]);

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

  return (
    <article className="flex flex-col gap-3">
      {stale && (
        <p role="status" className="border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Showing saved data while fresh prices load.
        </p>
      )}
      <ItemPageView
        context={{
          item,
          // A wiki page belongs to one item; ignore it if the page now shows another.
          wiki: wiki && initial?.item.id === item.id ? wiki : null,
          needs: summarizeNeeds(item),
          history: liveItem ? history(liveItem.name) : [],
          livePrice,
          now,
        }}
      />
    </article>
  );
}
