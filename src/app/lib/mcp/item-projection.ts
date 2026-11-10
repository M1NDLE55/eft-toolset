import type {
  CachedBarter,
  CachedContainedItem,
  CachedCraft,
  CachedItem,
  CachedTask,
  CachedTaskObjective,
  ComposedItem,
  ItemUses,
} from "@/app/lib/cache/types";
import { FLEA_MARKET, LOOT_ONLY, NO_FLEA_PRICE, bestSell, fleaPrices } from "@/app/lib/item-price";
import { summarizeNeeds, taskNeed } from "@/app/lib/item-needs";
import { round, type ToolContext } from "./context";
import { itemUrl } from "./sources";

// How item results describe prices, tasks, barters, and crafts.

function containedText(entries: CachedContainedItem[]) {
  return entries.map((entry) => `${entry.quantity}× ${entry.item.name}${entry.tool ? " (tool, kept)" : ""}`);
}

/** Objective types whose count is a number of items. */
const ITEM_COUNT_OBJECTIVES = new Set(["giveItem", "findItem", "plantItem", "sellItem", "mark"]);

/** The objective's text with how many of the item it takes, so "Hand over the item" says which and how many. */
function objectiveText(objective: CachedTaskObjective, item: Pick<CachedItem, "name" | "shortName">) {
  const description = objective.description ?? "";
  const details: string[] = [];
  const count = objective.count;
  if (typeof count === "number" && count > 0 && ITEM_COUNT_OBJECTIVES.has(objective.type ?? "")) {
    const text = description.toLowerCase();
    const named = [item.name, item.shortName].some((name) => name && text.includes(name.toLowerCase()));
    details.push(
      objective.alternatives
        ? // The count is shared: 10 of any mix of the 11 items it accepts, not 10 of each.
          `${count} of any of ${objective.alternatives + 1} items, this one included`
        : `${count}×${named ? "" : ` ${item.name}`}`
    );
    if (objective.foundInRaid) details.push("found in raid");
  }
  if (objective.optional) details.push("optional");
  return details.length > 0 ? `${description} (${details.join(", ")})` : description;
}

function projectTask(task: CachedTask, item: Pick<CachedItem, "name" | "shortName">) {
  const need = taskNeed(task);
  return {
    name: task.name,
    trader: task.trader.name,
    ...(task.faction ? { faction: task.faction } : {}),
    minPlayerLevel: task.minPlayerLevel,
    wikiLink: task.wikiLink,
    count: need.count,
    foundInRaid: need.foundInRaid > 0,
    objectives: task.objectives.flatMap((objective) =>
      objective.description ? [objectiveText(objective, item)] : []
    ),
  };
}

/** The keep-or-sell signal: how many are needed for tasks and the hideout, or null. */
export function neededSummary(uses: ItemUses, detailed = false) {
  const needs = summarizeNeeds(uses);
  if (!needs) return null;
  return {
    total: needs.total,
    foundInRaid: needs.foundInRaid,
    ...(detailed
      ? { forTasks: needs.forTasks, forHideout: needs.forHideout, hideoutSlots: needs.hideoutSlots }
      : {}),
    summary: needs.summary,
  };
}

function projectBarter(barter: CachedBarter) {
  return {
    trader: barter.trader.name,
    loyaltyLevel: barter.level,
    unlockedByTask: barter.taskUnlock?.name ?? null,
    give: containedText(barter.requiredItems),
    receive: containedText(barter.rewardItems),
  };
}

function projectCraft(craft: CachedCraft) {
  return {
    station: craft.station.name,
    level: craft.level,
    unlockedByTask: craft.taskUnlock?.name ?? null,
    input: containedText(craft.requiredItems),
    output: containedText(craft.rewardItems),
  };
}

/** Where a price comes from, so a flea average is never mistaken for a listing. */
export const PRICE_BASIS = {
  trader: "trader",
  fleaListing: "lowest flea listing",
  fleaAverage: "flea 24h average",
} as const;

type PriceBasis = (typeof PRICE_BASIS)[keyof typeof PRICE_BASIS];

type ProjectedOffer = {
  vendor: string;
  priceRUB: number;
  basis: PriceBasis;
  loyaltyLevel?: number;
  avg24hRUB?: number | null;
};

/**
 * Buy offers with the flea priced at its lowest current listing, so "cheapest" means cheapest.
 * The cached flea buy price is the 24-hour average the item page shows; it is kept as avg24hRUB.
 */
function buyOffers(item: CachedItem): ProjectedOffer[] {
  const flea = fleaPrices(item);
  return item.buyFor.map((offer) => {
    if (offer.vendor.name !== FLEA_MARKET) {
      return {
        vendor: offer.vendor.name,
        priceRUB: Math.round(offer.priceRUB),
        basis: PRICE_BASIS.trader,
        ...(offer.minTraderLevel ? { loyaltyLevel: offer.minTraderLevel } : {}),
      };
    }
    if (!flea) {
      return { vendor: FLEA_MARKET, priceRUB: Math.round(offer.priceRUB), basis: PRICE_BASIS.fleaAverage };
    }
    return {
      vendor: FLEA_MARKET,
      priceRUB: Math.round(flea.lowestListing),
      basis: PRICE_BASIS.fleaListing,
      avg24hRUB: flea.avg24h === null ? null : Math.round(flea.avg24h),
    };
  });
}

function sellOffers(item: CachedItem): ProjectedOffer[] {
  return item.sellFor.map((offer) => ({
    vendor: offer.vendor.name,
    priceRUB: Math.round(offer.priceRUB),
    basis: offer.vendor.name === FLEA_MARKET ? PRICE_BASIS.fleaListing : PRICE_BASIS.trader,
  }));
}

export const FLEA_STATUS = {
  listed: "listed",
  noListings: "no listings",
  banned: "banned",
} as const;

function fleaStatus(item: CachedItem) {
  if (item.fleaBanned) return FLEA_STATUS.banned;
  return item.sellFor.some((offer) => offer.vendor.name === FLEA_MARKET) ? FLEA_STATUS.listed : FLEA_STATUS.noListings;
}

function weaponNote(item: CachedItem) {
  if (!item.weapon) return undefined;
  const { defaultWidth, defaultHeight } = item.weapon;
  const build = defaultWidth && defaultHeight ? `default build ${defaultWidth}x${defaultHeight}; ` : "";
  return `Weapon: ${item.width}x${item.height} is the stripped weapon (${build}real size depends on attachments), so no per-slot value. Flea prices are for the default build, trader prices for the stripped weapon.`;
}

export function priceSummary(item: CachedItem) {
  const best = bestSell(item);
  const slots = item.width * item.height;
  const cheapestBuy = buyOffers(item).reduce<ProjectedOffer | null>(
    (cheapest, offer) =>
      offer.priceRUB > 0 && (!cheapest || offer.priceRUB < cheapest.priceRUB) ? offer : cheapest,
    null
  );
  const status = fleaStatus(item);
  const banned = status === FLEA_STATUS.banned;
  const noFlea = banned ? NO_FLEA_PRICE.banned : NO_FLEA_PRICE.noListings;
  const note = weaponNote(item);
  return {
    bestSell: best
      ? {
          vendor: best.vendor,
          priceRUB: Math.round(best.price),
          afterFleaFee: best.flea,
          perSlotRUB: item.weapon ? null : Math.round(best.price / slots),
        }
      : null,
    ...(best ? {} : { noSellReason: `No trader buys it and ${noFlea}.` }),
    cheapestBuy,
    ...(cheapestBuy ? {} : { noBuyReason: `No trader sells it for roubles and ${noFlea}.${banned ? ` ${LOOT_ONLY}` : ""}` }),
    flea: { status, minPlayerLevel: banned ? null : (item.fleaMinLevel ?? null) },
    fleaListingFeeRUB: item.fleaMarketFee,
    change48hPercent: round(item.changeLast48hPercent, 2),
    ...(note ? { sizeNote: note } : {}),
  };
}

export function projectDetail(item: ComposedItem, context: ToolContext, include: Set<string>) {
  return {
    id: item.id,
    name: item.name,
    shortName: item.shortName,
    url: itemUrl(context, item),
    wikiLink: item.wikiLink,
    size: `${item.width}x${item.height}`,
    slots: item.width * item.height,
    ...(item.weapon?.defaultWidth && item.weapon.defaultHeight
      ? { defaultBuildSize: `${item.weapon.defaultWidth}x${item.weapon.defaultHeight}` }
      : {}),
    ...priceSummary(item),
    buyFrom: buyOffers(item).toSorted((a, b) => a.priceRUB - b.priceRUB),
    sellTo: sellOffers(item).toSorted((a, b) => b.priceRUB - a.priceRUB),
    needed: neededSummary(item, true),
    ...(include.has("tasks")
      ? { usedInTasks: item.usedInTasks.map((task) => projectTask(task, item)) }
      : { usedInTaskCount: item.usedInTasks.length }),
    ...(include.has("hideout")
      ? {
          hideout: item.hideoutRequirements.map((entry) => ({
            station: entry.station.name,
            level: entry.level,
            count: entry.count,
            foundInRaid: entry.foundInRaid,
          })),
          hideoutSlots: item.hideoutSlots.map((entry) => ({
            station: entry.station.name,
            level: entry.level,
            slots: entry.slots,
          })),
        }
      : { hideoutUpgradeCount: item.hideoutRequirements.length }),
    ...(include.has("barters")
      ? { barters: item.bartersUsing.map(projectBarter) }
      : { barterCount: item.bartersUsing.length }),
    ...(include.has("crafts")
      ? { crafts: item.craftsUsing.map(projectCraft) }
      : { craftCount: item.craftsUsing.length }),
  };
}
