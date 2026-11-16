import type { ComposedItem } from "@/app/lib/cache/types";
import { FLEA_MARKET, bestSell } from "@/app/lib/item-price";
import { summarizeNeeds } from "@/app/lib/item-needs";
import { formatRoubles, plural } from "./format";

export interface FaqEntry {
  question: string;
  answer: string;
}

const MAX_TITLE_LABEL = 44;
const MAX_DESCRIPTION = 160;

/** The item's name, with its short name when players search by it (GPU, LEDX) and it fits. */
export function itemLabel(item: Pick<ComposedItem, "name" | "shortName">) {
  const short = item.shortName?.trim();
  if (!short || item.name.toLowerCase().includes(short.toLowerCase())) return item.name;
  const label = `${item.name} (${short})`;
  return label.length <= MAX_TITLE_LABEL ? label : item.name;
}

/** "Graphics card (GPU) Price & Uses in Tarkov"; the layout adds the site name. */
export function itemPageTitle(item: Pick<ComposedItem, "name" | "shortName">) {
  return `${itemLabel(item)} Price & Uses in Tarkov`;
}

function bestTraderSell(item: ComposedItem) {
  return item.sellFor
    .filter((offer) => offer.vendor.name !== FLEA_MARKET)
    .reduce<ComposedItem["sellFor"][number] | null>(
      (best, offer) => (!best || offer.priceRUB > best.priceRUB ? offer : best),
      null
    );
}

function usageCounts(item: ComposedItem) {
  const needs = summarizeNeeds(item);
  return {
    needs,
    barters: item.bartersUsing.length,
    crafts: item.craftsUsing.length,
  };
}

/**
 * A search-result description with the live numbers players look for: what it sells for, where,
 * and what it's needed for. Sentences are added while they fit.
 */
export function itemPageDescription(item: ComposedItem) {
  const best = bestSell(item);
  const trader = bestTraderSell(item);
  const { needs, barters, crafts } = usageCounts(item);
  const sentences: string[] = [];
  if (best?.flea) {
    sentences.push(`${item.name} sells for ${formatRoubles(best.price)} on the Tarkov flea market after fees.`);
    if (trader) sentences.push(`${trader.vendor.name} pays ${formatRoubles(trader.priceRUB)}.`);
  } else if (best) {
    sentences.push(`${item.name} sells for ${formatRoubles(best.price)} to ${best.vendor} in Tarkov.`);
  } else {
    sentences.push(`${item.name} prices and uses in Escape from Tarkov.`);
  }
  const uses = [
    needs && needs.taskCount > 0 ? plural(needs.taskCount, "task") : null,
    needs && needs.upgradeCount > 0 ? plural(needs.upgradeCount, "hideout upgrade") : null,
  ].filter(Boolean);
  if (uses.length > 0) sentences.push(`Needed for ${uses.join(" and ")}.`);
  else if (barters + crafts > 0) {
    sentences.push(`Used in ${[barters && plural(barters, "barter"), crafts && plural(crafts, "craft")].filter(Boolean).join(" and ")}.`);
  }
  sentences.push("Live PVP and PVE prices.");
  let description = "";
  for (const sentence of sentences) {
    const next = description ? `${description} ${sentence}` : sentence;
    if (next.length > MAX_DESCRIPTION && description) break;
    description = next;
  }
  return description;
}
