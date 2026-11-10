import type {
  CachedBarter,
  CachedContainedItem,
  CachedCraft,
  CachedItem,
  ComposedItem,
} from "@/app/lib/cache/types";
import { FLEA_MARKET, bestSell, fleaPrices } from "@/app/lib/item-price";
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

/** Where a price comes from, so a flea average is never mistaken for a listing. */
export const PRICE_BASIS = {
  trader: "trader",
  fleaListing: "lowest flea listing",
  fleaAverage: "flea 24h average",
} as const;

type PriceBasis = (typeof PRICE_BASIS)[keyof typeof PRICE_BASIS];

type ProjectedOffer = {
  vendor: string;
  priceRUB: number;
  basis: PriceBasis;
  avg24hRUB?: number | null;
};

/**
 * Buy offers with the flea priced at its lowest current listing, so "cheapest" means cheapest.
 * The cached flea buy price is the 24-hour average the item page shows; it is kept as avg24hRUB.
 */
function buyOffers(item: CachedItem): ProjectedOffer[] {
  const flea = fleaPrices(item);
  return item.buyFor.map((offer) => {
    if (offer.vendor.name !== FLEA_MARKET) {
      return { vendor: offer.vendor.name, priceRUB: Math.round(offer.priceRUB), basis: PRICE_BASIS.trader };
    }
    if (!flea) {
      return { vendor: FLEA_MARKET, priceRUB: Math.round(offer.priceRUB), basis: PRICE_BASIS.fleaAverage };
    }
    return {
      vendor: FLEA_MARKET,
      priceRUB: Math.round(flea.lowestListing),
      basis: PRICE_BASIS.fleaListing,
      avg24hRUB: flea.avg24h === null ? null : Math.round(flea.avg24h),
    };
  });
}

function sellOffers(item: CachedItem): ProjectedOffer[] {
  return item.sellFor.map((offer) => ({
    vendor: offer.vendor.name,
    priceRUB: Math.round(offer.priceRUB),
    basis: offer.vendor.name === FLEA_MARKET ? PRICE_BASIS.fleaListing : PRICE_BASIS.trader,
  }));
}

export function priceSummary(item: CachedItem) {
  const best = bestSell(item);
  const slots = item.width * item.height;
  const cheapestBuy = buyOffers(item).reduce<ProjectedOffer | null>(
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
    cheapestBuy,
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
    buyFrom: buyOffers(item).toSorted((a, b) => a.priceRUB - b.priceRUB),
    sellTo: sellOffers(item).toSorted((a, b) => b.priceRUB - a.priceRUB),
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
