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

/** The item's most specific category, unless it's one that says nothing ("Other", "Item"). */
function categoryOf(item: ComposedItem) {
  const category = item.info?.categories[0];
  return category && !/^(other|item|compound item|stackable item)$/i.test(category) ? category : null;
}

/**
 * A search-result description with the live numbers players look for: what it sells for, where,
 * what it's needed for (by quest name when there are few), what it opens and who sells it.
 * Each sentence comes in its longest wording that still fits, in that order; one that can't fit
 * is left out.
 */
export function itemPageDescription(item: ComposedItem, quests: ItemQuestUses | null = null) {
  const best = bestSell(item);
  const trader = bestTraderSell(item);
  const { needs, barters, crafts } = usageCounts(item);
  const category = categoryOf(item);
  const sentences: (string | null)[][] = [];
  if (best?.flea) {
    sentences.push([`${item.name} sells for ${formatRoubles(best.price)} on the Tarkov flea market after fees.`]);
    if (trader) sentences.push([`${trader.vendor.name} pays ${formatRoubles(trader.priceRUB)}.`]);
  } else if (best) {
    sentences.push([`${item.name} sells for ${formatRoubles(best.price)} to ${best.vendor} in Tarkov.`]);
  } else {
    sentences.push([category ? `${item.name} is a Tarkov ${category.toLowerCase()} item.` : `${item.name} in Escape from Tarkov.`]);
  }
  const named = quests?.needed.filter((quest) => quest.count > 0) ?? [];
  const fir = named.some((quest) => quest.foundInRaid > 0) ? " (found in raid)" : "";
  const hideout = needs && needs.upgradeCount > 0 ? plural(needs.upgradeCount, "hideout upgrade") : null;
  // The quest list counts quests as the page links them; without it, tarkov.dev's task uses.
  const taskCount = quests ? named.length : (needs?.taskCount ?? 0);
  const tasks = taskCount > 0 ? `${plural(taskCount, quests ? "quest" : "task")}${fir}` : null;
  sentences.push([
    named.length > 0 && named.length <= 2 ? `Needed for ${names(named.map((quest) => quest.name))}${fir}${hideout ? ` and ${hideout}` : ""}.` : null,
    tasks || hideout ? `Needed for ${[tasks, hideout].filter(Boolean).join(" and ")}.` : null,
  ]);
  if (barters + crafts > 0) sentences.push([`Used in ${[barters && plural(barters, "barter"), crafts && plural(crafts, "craft")].filter(Boolean).join(" and ")}.`]);
  if (quests && quests.keys.length > 0) sentences.push([`Key for ${names(quests.keys.map((quest) => quest.name), 1)}.`, `Key for ${plural(quests.keys.length, "quest")}.`]);
  if (item.key && item.key.maps.length > 0) sentences.push([`Opens locks on ${names(item.key.maps.map((map) => map.name), 2)}.`]);
  const seller = cheapestTrader(item);
  const onFlea = item.buyFor.some((offer) => offer.vendor.name === FLEA_MARKET);
  if (seller) sentences.push([`${seller.vendor.name} sells it${seller.minTraderLevel ? ` at LL${seller.minTraderLevel}` : ""}.`]);
  else if (!onFlea) sentences.push([item.fleaBanned ? "No trader sells it and it can't be traded on the flea market." : "No trader sells it."]);
  if (!best) sentences.push([`Takes ${item.width}×${item.height} slots.`]);
  if (best || onFlea) sentences.push(["Live PVP and PVE prices."]);
  let description = "";
  for (const variants of sentences) {
    const sentence = variants.find((variant): variant is string => variant !== null && (!description || description.length + 1 + variant.length <= MAX_DESCRIPTION));
    if (sentence) description = description ? `${description} ${sentence}` : sentence;
  }
  return description;
}

/** The quests that use an item, as the item page lists them (see questsUsingItem). */
export interface ItemQuestUses {
  needed: { name: string; count: number; foundInRaid: number }[];
  keys: { name: string }[];
}

function names(list: string[], max = 3) {
  const shown = list.length <= max + 1 ? list : [...list.slice(0, max), `${list.length - max} more`];
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown.join("");
}

/** Prices move all day: "about 21,000 ₽" says enough in prose. */
function about(value: number) {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, value))) - 1);
  return formatRoubles(Math.round(value / step) * step);
}

/** The cheapest trader offer, with the loyalty level and task it needs. */
function cheapestTrader(item: ComposedItem) {
  return item.buyFor.filter((offer) => offer.vendor.name !== FLEA_MARKET).toSorted((a, b) => a.priceRUB - b.priceRUB)[0] ?? null;
}


/**
 * A short brief for the item page, from tarkov.dev's data: what it is, where to get it, what it
 * sells for and what needs it. Each entry is a paragraph; numbers are rounded, since prices move.
 */
export function itemSummary(item: ComposedItem, quests: ItemQuestUses | null = null): string[] {
  const paragraphs: string[] = [];
  const category = categoryOf(item);
  const what: string[] = [];
  // A weapon's own size and weight are its bare receiver's; its default build is what's priced.
  const build = item.weapon?.defaultWidth && item.weapon.defaultHeight ? `${item.weapon.defaultWidth}×${item.weapon.defaultHeight}` : null;
  const size = build ? `Its default build takes ${build} slots.` : `It takes ${item.width}×${item.height} slots${item.info?.weight ? ` and weighs ${Number(item.info.weight.toFixed(2))} kg` : ""}.`;
  what.push(category ? `In Escape from Tarkov, ${item.name} is in the ${category} category. ${size}` : `${item.name} is an Escape from Tarkov item. ${size}`);
  if (build) what.push("Its flea market price is for that default build.");
  if (item.key && item.key.maps.length > 0) {
    const locks = item.key.maps.reduce((total, map) => total + map.locks, 0);
    what.push(`It opens ${plural(locks, "lock")} on ${names(item.key.maps.map((map) => map.name))}.`);
  }
  paragraphs.push(what.join(" "));

  const get: string[] = [];
  const trader = cheapestTrader(item);
  if (trader) {
    const level = trader.minTraderLevel ? ` at loyalty level ${trader.minTraderLevel}` : "";
    const task = trader.taskUnlock ? `, once you complete ${trader.taskUnlock.name}` : "";
    get.push(`${trader.vendor.name} sells it${level} for ${about(trader.priceRUB)}${task}.`);
  }
  const flea = item.buyFor.find((offer) => offer.vendor.name === FLEA_MARKET);
  if (flea) get.push(`On the flea market it costs about ${about(flea.priceRUB)}${item.fleaMinLevel ? `, from player level ${item.fleaMinLevel}` : ""}.`);
  else if (item.fleaBanned) get.push("It can't be traded on the flea market.");
  const barters = item.bartersGiving?.length ?? 0;
  const crafts = item.craftsGiving?.length ?? 0;
  if (barters + crafts > 0) {
    const ways = [barters ? plural(barters, "barter") : null, crafts ? plural(crafts, "craft") : null].filter(Boolean).join(" and ");
    get.push(`${trader || flea ? "It also comes from" : "It comes from raids and from"} ${ways}.`);
  } else if (!trader && !flea) get.push("No trader sells it: it comes from raids.");
  paragraphs.push(get.join(" "));

  const best = bestSell(item);
  if (best) {
    const slots = item.width * item.height;
    const perSlot = slots > 1 ? `, about ${about(best.price / slots)} per slot` : "";
    paragraphs.push(
      best.flea
        ? `It sells for about ${about(best.price)} on the flea market after the fee${perSlot}${bestTraderSell(item) ? `, or ${about(bestTraderSell(item)!.priceRUB)} to ${bestTraderSell(item)!.vendor.name}` : ""}.`
        : `It sells for about ${about(best.price)} to ${best.vendor}${perSlot}.`
    );
  }

  const uses: string[] = [];
  const needed = quests?.needed ?? [];
  const specific = needed.filter((quest) => quest.count > 0);
  if (specific.length > 0) {
    const count = specific.reduce((total, quest) => total + quest.count, 0);
    const fir = specific.reduce((total, quest) => total + quest.foundInRaid, 0);
    uses.push(
      `${specific.length === 1 ? "One quest needs" : `${specific.length} quests need`} ${count} of it${fir > 0 ? ` (${fir === count ? "all" : fir} found in raid)` : ""}: ${names(specific.map((quest) => quest.name))}.`
    );
  }
  if (needed.length > specific.length) uses.push(`${plural(needed.length - specific.length, "more quest")} ${needed.length - specific.length === 1 ? "accepts" : "accept"} it among other items.`);
  if (quests && quests.keys.length > 0) uses.push(`As a key, it's needed for ${names(quests.keys.map((quest) => quest.name))}.`);
  if (item.hideoutRequirements.length > 0) {
    const upgrades = item.hideoutRequirements.map((entry) => `${entry.count} for ${entry.station.name} level ${entry.level}${entry.foundInRaid ? " (found in raid)" : ""}`);
    uses.push(`Hideout upgrades need ${names(upgrades)}.`);
  }
  const using = [item.bartersUsing.length ? plural(item.bartersUsing.length, "barter") : null, item.craftsUsing.length ? plural(item.craftsUsing.length, "craft") : null].filter(Boolean);
  if (using.length > 0) uses.push(`It goes into ${using.join(" and ")}.`);
  if (uses.length === 0) uses.push(quests ? "No quest, hideout upgrade, barter or craft uses it." : "No hideout upgrade, barter or craft uses it.");
  paragraphs.push(uses.join(" "));
  return paragraphs;
}
