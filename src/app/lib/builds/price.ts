import type { PriceSources } from "@/app/lib/types/gunBuilder";

export const ALL_PRICE_SOURCES: PriceSources = { traders: true, flea: true };

/**
 * Cheapest price for an item across the enabled purchase sources. Returns null
 * when the item has no price in any enabled source (e.g. barter/craft-only, or
 * flea-only with flea disabled).
 */
export function effectivePrice(
  item: { traderPriceRUB: number | null; fleaPriceRUB: number | null },
  sources: PriceSources
): number | null {
  const prices: number[] = [];
  if (sources.traders && Number.isFinite(item.traderPriceRUB)) {
    prices.push(item.traderPriceRUB as number);
  }
  if (sources.flea && Number.isFinite(item.fleaPriceRUB)) {
    prices.push(item.fleaPriceRUB as number);
  }
  return prices.length ? Math.min(...prices) : null;
}
