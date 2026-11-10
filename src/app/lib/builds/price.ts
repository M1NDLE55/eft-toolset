import type { PriceSources, TraderOffer } from "@/app/lib/types/gunBuilder";

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

/** The trader loyalty levels a player has: one cap for every trader, and per-trader levels (0 = locked). */
export interface TraderLimits {
  maxLevel?: number | null;
  /** Keyed by trader name in lower case. */
  levels?: Readonly<Record<string, number>>;
}

interface Offered {
  traderPriceRUB: number | null;
  traderName?: string | null;
  traderLevel?: number | null;
  traderOffers?: readonly TraderOffer[];
}

export function hasTraderLimits(limits: TraderLimits | null | undefined): limits is TraderLimits {
  return Boolean(limits && (limits.maxLevel != null || Object.keys(limits.levels ?? {}).length > 0));
}

/** The level a player has with a trader, or null when it is not limited. */
export function allowedTraderLevel(trader: string, limits: TraderLimits): number | null {
  return limits.levels?.[trader.toLowerCase()] ?? limits.maxLevel ?? null;
}

export function offerAllowed(offer: TraderOffer, limits: TraderLimits) {
  const allowed = allowedTraderLevel(offer.trader, limits);
  return allowed === null || (offer.level ?? 1) <= allowed;
}

/**
 * The item with its trader price taken from the cheapest offer the player's loyalty levels
 * allow. Items without offer details are returned unchanged.
 */
export function withTraderLimits<T extends Offered>(item: T, limits: TraderLimits): T {
  if (!item.traderOffers) return item;
  const best = item.traderOffers.find((offer) => offerAllowed(offer, limits));
  if (best?.priceRUB === item.traderPriceRUB && best.trader === item.traderName && best.level === item.traderLevel) {
    return item;
  }
  return {
    ...item,
    traderPriceRUB: best?.priceRUB ?? null,
    traderName: best?.trader ?? null,
    traderLevel: best?.level ?? null,
  };
}
