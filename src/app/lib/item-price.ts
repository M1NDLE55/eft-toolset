import type { CachedItem } from "@/app/lib/cache/types";

export const FLEA_MARKET = "Flea Market";

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
