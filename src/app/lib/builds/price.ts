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

/** What the player can buy: loyalty levels (a trader level of 0 disables that trader) and completed tasks. */
export interface TraderLimits {
  maxLevel?: number | null;
  /** Keyed by trader name in lower case. */
  levels?: Readonly<Record<string, number>>;
  /** Leave out offers locked behind a task that isn't in completedTasks. */
  excludeQuestLocked?: boolean;
  /** Ids of completed tasks, including the tasks they required. */
  completedTasks?: ReadonlySet<string>;
}

interface LimitedOffer {
  trader: string;
  priceRUB: number | null;
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

// Offers must be sorted cheapest first.
export function bestOffer<T extends LimitedOffer>(offers: readonly T[] | undefined, limits: TraderLimits | null): T | null {
  const limited = hasTraderLimits(limits);
  return offers?.find((offer) => offer.priceRUB !== null && (!limited || offerAllowed(offer, limits))) ?? null;
}

// Null and missing fields count as equal.
function update<T extends object>(item: T, fields: Record<string, unknown>): T {
  const current = item as Record<string, unknown>;
  const changed = Object.entries(fields).some(([key, value]) => (current[key] ?? null) !== value);
  return changed ? { ...item, ...fields } : item;
}

export function withTraderLimits<T extends Offered>(item: T, limits: TraderLimits): T {
  if (!item.traderOffers) return item;
  const best = bestOffer(item.traderOffers, limits);
  return update(item, {
    traderPriceRUB: best?.priceRUB ?? null,
    traderName: best?.trader ?? null,
    traderLevel: best?.level ?? null,
    traderTask: best?.taskUnlock?.name ?? null,
  });
}

// Barters without input offers keep their existing price.
export function barterCost(barter: BarterOffer, sources: PriceSources, limits: TraderLimits | null) {
  if (!barter.requiredItems.every((input) => input.traderOffers)) return barter.priceRUB;
  let total = 0;
  for (const input of barter.requiredItems) {
    const unit = effectivePrice(
      { traderPriceRUB: bestOffer(input.traderOffers, limits)?.priceRUB ?? null, fleaPriceRUB: input.fleaPriceRUB ?? null },
      sources
    );
    if (unit === null) return null;
    total += unit * input.count;
  }
  return Math.round(total / barter.count);
}

export function withBarterPrices<T extends Offered>(item: T, sources: PriceSources, limits: TraderLimits | null): T {
  if (!item.barterOffers?.length) return item;
  const barterOffers = item.barterOffers
    .map((offer) => ({ ...offer, priceRUB: barterCost(offer, sources, limits) }))
    .sort((a, b) => (a.priceRUB ?? Number.POSITIVE_INFINITY) - (b.priceRUB ?? Number.POSITIVE_INFINITY));
  return { ...item, barterOffers, barterPriceRUB: bestOffer(barterOffers, limits)?.priceRUB ?? null };
}

export type PriceSource = "trader" | "flea" | "barter";

export type PriceChoice =
  | { source: "trader"; priceRUB: number; offer: TraderOffer | null }
  | { source: "flea"; priceRUB: number }
  | { source: "barter"; priceRUB: number; offer: BarterOffer | null };

// Equal prices prefer trader, then flea, then barter.
export function priceChoice(
  item: Offered & { fleaPriceRUB: number | null },
  sources: PriceSources,
  limits: TraderLimits | null
): PriceChoice | null {
  const choices: PriceChoice[] = [];
  const trader = sources.traders ? positive(item.traderPriceRUB) : null;
  if (trader !== null) {
    const offer = bestOffer(item.traderOffers, limits);
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

export function traderLabel(trader: string, level: number | null | undefined) {
  return `${trader}${level ? ` LL${level}` : ""}`;
}

export function offerLabel(offer: { trader: string; level: number | null; preset?: string }) {
  return `${traderLabel(offer.trader, offer.level)}${offer.preset ? " (default preset)" : ""}`;
}

export interface TraderQuote {
  priceRUB: number;
  trader: string | null;
  level: number | null;
  task: string | null;
  offer: TraderOffer | null;
}

// preset: false = bare weapon, true = default preset, undefined = either.
export function traderQuote(item: Offered, limits: TraderLimits | null, preset?: boolean): TraderQuote | null {
  if (item.traderOffers) {
    const offers = preset === undefined ? item.traderOffers : item.traderOffers.filter((offer) => Boolean(offer.preset) === preset);
    const offer = bestOffer(offers, limits);
    const price = positive(offer?.priceRUB);
    if (!offer || price === null) return null;
    return { priceRUB: price, trader: offer.trader, level: offer.level, task: offer.taskUnlock?.name ?? null, offer };
  }
  // Items without offer lists only have a price for the item itself.
  const price = preset ? null : positive(item.traderPriceRUB);
  if (price === null) return null;
  return { priceRUB: price, trader: item.traderName ?? null, level: item.traderLevel ?? null, task: item.traderTask ?? null, offer: null };
}

export interface SourceLabel {
  label: string;
  task: string | null;
}

export function sourceLabel(
  choice: PriceChoice | null,
  item: { traderName?: string | null; traderLevel?: number | null; traderTask?: string | null }
): SourceLabel | null {
  if (!choice) return null;
  if (choice.source === "flea") return { label: "Flea", task: null };
  if (choice.offer) {
    const label = offerLabel(choice.offer);
    return { label: choice.source === "barter" ? `${label} barter` : label, task: choice.offer.taskUnlock?.name ?? null };
  }
  if (choice.source === "barter") return { label: "Barter", task: null };
  return item.traderName ? { label: traderLabel(item.traderName, item.traderLevel), task: item.traderTask ?? null } : null;
}
