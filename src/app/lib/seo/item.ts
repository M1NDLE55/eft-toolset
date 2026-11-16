import type { ComposedItem } from "@/app/lib/cache/types";
import { FLEA_MARKET, bestSell, fleaPrices } from "@/app/lib/item-price";
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

function cheapestBuy(item: ComposedItem) {
  return item.buyFor.reduce<ComposedItem["buyFor"][number] | null>(
    (cheapest, offer) => (!cheapest || offer.priceRUB < cheapest.priceRUB ? offer : cheapest),
    null
  );
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

/** Questions players search for, answered from the item's live data. */
export function itemFaq(item: ComposedItem): FaqEntry[] {
  const name = item.name;
  const best = bestSell(item);
  const flea = fleaPrices(item);
  const trader = bestTraderSell(item);
  const buy = cheapestBuy(item);
  const slots = item.width * item.height;
  const { needs, barters, crafts } = usageCounts(item);
  const entries: FaqEntry[] = [];

  let worth: string;
  if (best?.flea && flea) {
    worth = `${name} sells for about ${formatRoubles(best.price)} on the flea market after the listing fee`;
    worth += flea.avg24h ? `, with a 24-hour average of ${formatRoubles(flea.avg24h)}.` : ".";
    if (!item.weapon && slots > 1) worth += ` That's ${formatRoubles(best.price / slots)} per slot across its ${slots} slots.`;
  } else if (best) {
    worth = `${name} sells for ${formatRoubles(best.price)} to ${best.vendor}.`;
    if (item.fleaBanned) worth += " It can't be sold on the flea market.";
  } else {
    worth = `${name} can't currently be sold to traders or on the flea market.`;
  }
  entries.push({ question: `How much is ${name} worth in Tarkov?`, answer: worth });

  if (best) {
    let where = best.flea
      ? `The flea market pays the most: ${formatRoubles(best.price)} after the fee.`
      : `${best.vendor} pays the most: ${formatRoubles(best.price)}.`;
    if (best.flea && trader) where += ` The best trader is ${trader.vendor.name} at ${formatRoubles(trader.priceRUB)}, with no fee and no listing wait.`;
    if (best.flea && item.fleaMinLevel) where += ` Selling on the flea market needs player level ${item.fleaMinLevel}.`;
    entries.push({ question: `Where should I sell ${name}?`, answer: where });
  }

  let keep: string;
  if (needs && needs.total > 0) {
    const parts = [
      needs.forTasks > 0 ? `${needs.forTasks} for ${plural(needs.taskCount, "task")}` : null,
      needs.forHideout > 0 ? `${needs.forHideout} for ${plural(needs.upgradeCount, "hideout upgrade")}` : null,
    ].filter(Boolean);
    keep = `Keep it if you still have tasks or upgrades left: ${needs.total} ${needs.total === 1 ? "is" : "are"} needed in total (${parts.join(", ")})`;
    keep += needs.foundInRaid > 0 ? `, and ${needs.foundInRaid} must be found in raid.` : ".";
  } else if (barters + crafts > 0) {
    keep = `No task or hideout upgrade needs it, so it's safe to sell. It is used in ${[barters && plural(barters, "barter"), crafts && plural(crafts, "craft")].filter(Boolean).join(" and ")}.`;
  } else {
    keep = "No task, hideout upgrade, barter or craft uses it, so it's safe to sell.";
  }
  if (needs && needs.hideoutSlots > 0) keep += ` It can also be installed in ${plural(needs.hideoutSlots, "hideout slot")}.`;
  entries.push({ question: `Should I keep or sell ${name}?`, answer: keep });

  let buyAnswer: string;
  if (buy && buy.vendor.name === FLEA_MARKET) {
    buyAnswer = `Buy it on the flea market for about ${formatRoubles(buy.priceRUB)}.`;
  } else if (buy) {
    buyAnswer = `${buy.vendor.name} sells it for ${formatRoubles(buy.priceRUB)}`;
    if (buy.minTraderLevel) buyAnswer += ` at loyalty level ${buy.minTraderLevel}`;
    buyAnswer += buy.taskUnlock ? `, after completing ${buy.taskUnlock.name}.` : ".";
  } else {
    buyAnswer = "No trader sells it and it can't be bought on the flea market: find it in raid, or get it from a barter or craft.";
  }
  entries.push({ question: `Where can I buy ${name}?`, answer: buyAnswer });

  return entries;
}
