import type { BarterOffer, PriceSources, TaskUnlock, TraderOffer } from "@/app/lib/types/gunBuilder";

function positive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

interface Priced {
  traderPriceRUB: number | null;
  fleaPriceRUB: number | null;
  barterPriceRUB?: number | null;
}

export function effectivePrice(item: Priced, sources: PriceSources): number | null {
  const prices = [
    sources.traders ? positive(item.traderPriceRUB) : null,
    sources.flea ? positive(item.fleaPriceRUB) : null,
    sources.barters ? positive(item.barterPriceRUB) : null,
  ].filter((price): price is number => price !== null);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * What the player can buy: loyalty levels (one cap for every trader, and per-trader levels,
 * 0 = locked) and the tasks they have completed.
 */
export interface TraderLimits {
  maxLevel?: number | null;
  /** Keyed by trader name in lower case. */
  levels?: Readonly<Record<string, number>>;
  /** Leave out offers locked behind a task that isn't in completedTasks. */
  excludeQuestLocked?: boolean;
  /** Ids of completed tasks, including the tasks they required. */
  completedTasks?: ReadonlySet<string>;
}

/** An offer the limits can rule out: a trader offer or a barter. */
interface LimitedOffer {
  trader: string;
  level: number | null;
  taskUnlock?: TaskUnlock;
}

interface Offered extends Priced {
  traderName?: string | null;
  traderLevel?: number | null;
  traderTask?: string | null;
  traderOffers?: readonly TraderOffer[];
  barterOffers?: readonly BarterOffer[];
}

export function hasTraderLimits(limits: TraderLimits | null | undefined): limits is TraderLimits {
  return Boolean(
    limits && (limits.maxLevel != null || Object.keys(limits.levels ?? {}).length > 0 || limits.excludeQuestLocked)
  );
}

/** The level a player has with a trader, or null when it is not limited. */
export function allowedTraderLevel(trader: string, limits: TraderLimits): number | null {
  return limits.levels?.[trader.toLowerCase()] ?? limits.maxLevel ?? null;
}

/** Whether the offer's task is still to do: it has one, and it isn't in completedTasks. */
export function questLocked(offer: { taskUnlock?: TaskUnlock }, limits: TraderLimits | null | undefined) {
  return Boolean(offer.taskUnlock && !limits?.completedTasks?.has(offer.taskUnlock.id));
}

export function levelAllowed(offer: LimitedOffer, limits: TraderLimits) {
  const allowed = allowedTraderLevel(offer.trader, limits);
  return allowed === null || (offer.level ?? 1) <= allowed;
}

export function offerAllowed(offer: LimitedOffer, limits: TraderLimits) {
  return levelAllowed(offer, limits) && !(limits.excludeQuestLocked && questLocked(offer, limits));
}

/** The cheapest offer the limits allow; offers are sorted cheapest first. */
export function bestOffer<T extends LimitedOffer>(offers: readonly T[] | undefined, limits: TraderLimits | null): T | null {
  if (!offers) return null;
  return (hasTraderLimits(limits) ? offers.find((offer) => offerAllowed(offer, limits)) : offers[0]) ?? null;
}

/**
 * The item with its trader and barter prices taken from the cheapest offers the player's
 * limits allow. Items without offer details are returned unchanged.
 */
export function withTraderLimits<T extends Offered>(item: T, limits: TraderLimits): T {
  if (!item.traderOffers && !item.barterOffers) return item;
  const best = item.traderOffers ? bestOffer(item.traderOffers, limits) : undefined;
  const barter = item.barterOffers ? bestOffer(item.barterOffers, limits) : undefined;
  const trader =
    best === undefined
      ? {}
      : {
          traderPriceRUB: best?.priceRUB ?? null,
          traderName: best?.trader ?? null,
          traderLevel: best?.level ?? null,
          traderTask: best?.taskUnlock?.name ?? null,
        };
  const barterPrice = barter === undefined ? {} : { barterPriceRUB: barter?.priceRUB ?? null };
  const current = item as Record<string, unknown>;
  // null and a missing field mean the same, so an item already at these prices is kept as is.
  const changed = Object.entries({ ...trader, ...barterPrice }).some(
    ([key, value]) => current[key] !== value && (current[key] ?? null) !== value
  );
  return changed ? { ...item, ...trader, ...barterPrice } : item;
}

export type PriceSource = "trader" | "flea" | "barter";

export type PriceChoice =
  | { source: "trader"; priceRUB: number; offer: TraderOffer | null }
  | { source: "flea"; priceRUB: number }
  | { source: "barter"; priceRUB: number; offer: BarterOffer | null };

/**
 * Where an item's price comes from: the cheapest enabled source, preferring a trader, then
 * the flea, then a barter at equal prices. It agrees with effectivePrice on an item limited
 * by the same limits.
 */
export function priceChoice(
  item: Offered & { fleaPriceRUB: number | null },
  sources: PriceSources,
  limits: TraderLimits | null
): PriceChoice | null {
  const choices: PriceChoice[] = [];
  const trader = sources.traders ? positive(item.traderPriceRUB) : null;
  if (trader !== null) {
    const offer = item.traderOffers ? bestOffer(item.traderOffers, limits) : null;
    choices.push({ source: "trader", priceRUB: trader, offer: offer?.priceRUB === trader ? offer : null });
  }
  const flea = sources.flea ? positive(item.fleaPriceRUB) : null;
  if (flea !== null) choices.push({ source: "flea", priceRUB: flea });
  const barter = sources.barters ? positive(item.barterPriceRUB) : null;
  if (barter !== null) {
    const offer = bestOffer(item.barterOffers, limits);
    choices.push({ source: "barter", priceRUB: barter, offer: offer?.priceRUB === barter ? offer : null });
  }
  return choices.reduce<PriceChoice | null>((best, choice) => (!best || choice.priceRUB < best.priceRUB ? choice : best), null);
}

/** "Prapor LL2", with " (default preset)" when the offer is for the weapon's default preset. */
export function offerLabel(offer: { trader: string; level: number | null; preset?: string }) {
  return `${offer.trader}${offer.level ? ` LL${offer.level}` : ""}${offer.preset ? " (default preset)" : ""}`;
}
