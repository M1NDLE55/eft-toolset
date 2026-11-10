import type { CachedItem } from "@/app/lib/cache/types";

export const FLEA_MARKET = "Flea Market";

/**
 * Why an item has no flea price, worded once for the item tools and the gun builder. Whether an
 * item is banned comes from one place too: the fleaBanned flag tarkov-server.ts sets.
 */
export const NO_FLEA_PRICE = {
  banned: "it is banned from the flea market",
  noListings: "it has no current flea listings",
  noPrice: "it has no flea price",
  turnedOff: "flea prices are turned off",
} as const;

/** Said of a flea-banned item no trader sells for roubles. */
export const LOOT_ONLY = "Only found in raid, bartered, or crafted.";

export interface BestSell {
  vendor: string;
  price: number;
  flea: boolean;
}

export function bestSell(item: Pick<CachedItem, "sellFor" | "fleaMarketFee">): BestSell | null {
  let best: BestSell | null = null;
  for (const offer of item.sellFor) {
    const flea = offer.vendor.name === FLEA_MARKET;
    if (flea && item.fleaMarketFee === null) continue;
    const price = flea ? offer.priceRUB - (item.fleaMarketFee ?? 0) : offer.priceRUB;
    if (price > 0 && (!best || price > best.price)) best = { vendor: offer.vendor.name, price, flea };
  }
  return best;
}

export interface FleaPrices {
  /** The lowest current listing (tarkov.dev lastLowPrice). */
  lowestListing: number;
  /** The 24-hour average, or null when tarkov.dev has none (or it equals the lowest listing). */
  avg24h: number | null;
}

/**
 * An item's flea prices. The cached item's flea sell offer is the lowest current listing and its
 * flea buy offer is the 24-hour average, falling back to the lowest listing when there is no average.
 */
export function fleaPrices(item: Pick<CachedItem, "buyFor" | "sellFor">): FleaPrices | null {
  const listing = item.sellFor.find((offer) => offer.vendor.name === FLEA_MARKET)?.priceRUB;
  if (listing === undefined) return null;
  const buy = item.buyFor.find((offer) => offer.vendor.name === FLEA_MARKET)?.priceRUB;
  return { lowestListing: listing, avg24h: buy !== undefined && buy !== listing ? buy : null };
}
