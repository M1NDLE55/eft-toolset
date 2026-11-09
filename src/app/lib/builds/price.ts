import type { PriceSources } from "@/app/lib/types/gunBuilder";

function positive(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function effectivePrice(
  item: { traderPriceRUB: number | null; fleaPriceRUB: number | null },
  sources: PriceSources
): number | null {
  const trader = sources.traders ? positive(item.traderPriceRUB) : null;
  const flea = sources.flea ? positive(item.fleaPriceRUB) : null;
  if (trader === null) return flea;
  if (flea === null) return trader;
  return Math.min(trader, flea);
}
