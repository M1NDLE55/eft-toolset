import type {
  CachedBarter,
  CachedContainedItem,
  CachedCraft,
  CachedItem,
  ComposedItem,
} from "@/app/lib/cache/types";
import { bestSell } from "@/app/lib/item-price";
import { round, type ToolContext } from "./context";
import { itemUrl } from "./sources";

// How item results describe prices, tasks, barters, and crafts.

function containedText(entries: CachedContainedItem[]) {
  return entries.map((entry) => `${entry.quantity}× ${entry.item.name}`);
}

function projectBarter(barter: CachedBarter) {
  return {
    trader: barter.trader.name,
    loyaltyLevel: barter.level,
    unlockedByTask: barter.taskUnlock?.name ?? null,
    give: containedText(barter.requiredItems),
    receive: containedText(barter.rewardItems),
  };
}

function projectCraft(craft: CachedCraft) {
  return {
    station: craft.station.name,
    level: craft.level,
    unlockedByTask: craft.taskUnlock?.name ?? null,
    input: containedText(craft.requiredItems),
    output: containedText(craft.rewardItems),
  };
}

export function priceSummary(item: CachedItem) {
  const best = bestSell(item);
  const slots = item.width * item.height;
  const cheapestBuy = item.buyFor.reduce<CachedItem["buyFor"][number] | null>(
    (cheapest, offer) =>
      offer.priceRUB > 0 && (!cheapest || offer.priceRUB < cheapest.priceRUB) ? offer : cheapest,
    null
  );
  return {
    bestSell: best
      ? {
          vendor: best.vendor,
          priceRUB: Math.round(best.price),
          afterFleaFee: best.flea,
          perSlotRUB: Math.round(best.price / slots),
        }
      : null,
    cheapestBuy: cheapestBuy
      ? { vendor: cheapestBuy.vendor.name, priceRUB: Math.round(cheapestBuy.priceRUB) }
      : null,
    fleaListingFeeRUB: item.fleaMarketFee,
    change48hPercent: round(item.changeLast48hPercent, 2),
  };
}

export function projectDetail(item: ComposedItem, context: ToolContext, include: Set<string>) {
  return {
    id: item.id,
    name: item.name,
    shortName: item.shortName,
    url: itemUrl(context, item),
    wikiLink: item.wikiLink,
    size: `${item.width}x${item.height}`,
    slots: item.width * item.height,
    ...priceSummary(item),
    buyFrom: item.buyFor
      .toSorted((a, b) => a.priceRUB - b.priceRUB)
      .map((offer) => ({ vendor: offer.vendor.name, priceRUB: Math.round(offer.priceRUB) })),
    sellTo: item.sellFor
      .toSorted((a, b) => b.priceRUB - a.priceRUB)
      .map((offer) => ({ vendor: offer.vendor.name, priceRUB: Math.round(offer.priceRUB) })),
    ...(include.has("tasks")
      ? {
          usedInTasks: item.usedInTasks.map((task) => ({
            name: task.name,
            trader: task.trader.name,
            minPlayerLevel: task.minPlayerLevel,
            wikiLink: task.wikiLink,
            objectives: task.objectives.flatMap((objective) =>
              objective.description ? [objective.description] : []
            ),
          })),
        }
      : { usedInTaskCount: item.usedInTasks.length }),
    ...(include.has("barters")
      ? { barters: item.bartersUsing.map(projectBarter) }
      : { barterCount: item.bartersUsing.length }),
    ...(include.has("crafts")
      ? { crafts: item.craftsUsing.map(projectCraft) }
      : { craftCount: item.craftsUsing.length }),
  };
}
