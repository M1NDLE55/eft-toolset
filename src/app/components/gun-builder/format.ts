import { Rubles } from "@/app/lib/currency";
import { priceChoice, sourceLabel, traderLabel, traderQuote, type SourceLabel } from "@/app/lib/builds/price";
import type { PriceSources, TraderOffer } from "@/app/lib/types/gunBuilder";

export function formatErgo(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export function formatRecoilModifier(value: number) {
  const percent = Math.round(value * 1000) / 10;
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

export function formatRub(value: number | null) {
  return value === null ? "—" : Rubles.format(Math.round(value));
}

export function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export function modeLabel(gameMode: string) {
  return gameMode === "pve" ? "PVE" : "PVP";
}

export function formatWeight(value: number) {
  return `${value.toFixed(2)} kg`;
}

export function taskHint(task: string | null | undefined) {
  return task ? `After the task ${task}` : undefined;
}

interface Sold {
  traderPriceRUB: number | null;
  fleaPriceRUB: number | null;
  traderName?: string | null;
  traderLevel?: number | null;
  traderTask?: string | null;
  traderOffers?: readonly TraderOffer[];
}

export interface ShownPrice {
  price: number | null;
  /** Where price comes from, to show under it. */
  source: SourceLabel | null;
  /** The trader offer passed over for a cheaper flea price, with its own price and task. */
  traderNote: string | undefined;
}

/** An item's price from the selected sources, labelled with the source that charges it. */
export function shownPrice(item: Sold, sources: PriceSources): ShownPrice {
  const choice = priceChoice(item, sources, null);
  const quote = choice?.source === "flea" && sources.traders ? traderQuote(item, null) : null;
  return {
    price: choice?.priceRUB ?? null,
    source: sourceLabel(choice, item),
    traderNote: quote
      ? `${quote.trader ? traderLabel(quote.trader, quote.level) : "A trader"} sells it for ${formatRub(quote.priceRUB)}${quote.task ? ` after the task ${quote.task}` : ""}`
      : undefined,
  };
}
