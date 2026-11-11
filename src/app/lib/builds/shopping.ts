import { escapeDiscordText } from "@/app/lib/text-safety";
import type { BarterOffer, BuildNode, PriceSources, TraderOffer } from "@/app/lib/types/gunBuilder";
import { priceChoice, traderLabel, traderQuote, type PriceSource } from "./price";
import { pathKey, planPurchase, type PurchaseContext } from "./purchase";
import type { ItemLookup } from "./stats";

export interface ShoppingRow {
  itemId: string;
  name: string;
  shortName: string;
  normalizedName: string | null;
  count: number;
  /** How many come with the weapon's preset, so aren't bought. */
  withWeapon: number;
  isWeapon: boolean;
  /** Cash offer matching the weapon's purchased form. */
  traderPriceRUB: number | null;
  fleaPriceRUB: number | null;
  traderName: string | null;
  traderLevel: number | null;
  traderTask: string | null;
  source: PriceSource | null;
  /** The trader offer or barter bought from, when the item lists its offers. */
  offer?: TraderOffer | BarterOffer | null;
  unitPriceRUB: number | null;
  subtotalRUB: number | null;
}

export interface ShoppingList {
  rows: ShoppingRow[];
  totalRUB: number;
  itemCount: number;
  unpricedCount: number;
}

function positive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function buildShoppingList(
  root: BuildNode,
  lookup: ItemLookup,
  sources: PriceSources,
  includeWeapon = true,
  pricing: PurchaseContext = {}
): ShoppingList {
  const context = includeWeapon ? pricing : { ...pricing, preset: null };
  const purchase = planPurchase(root, lookup, sources, context);
  const limits = pricing.limits ?? null;
  const counts = new Map<string, number>();
  const withWeapon = new Map<string, number>();
  const order: string[] = [];
  const stack: { node: BuildNode; path: string[] }[] = [{ node: root, path: [] }];
  while (stack.length > 0) {
    const { node, path } = stack.shift()!;
    stack.unshift(...Object.entries(node.slots).map(([slotId, child]) => ({ node: child, path: [...path, slotId] })));
    if (node === root && !includeWeapon) continue;
    if (!counts.has(node.itemId)) order.push(node.itemId);
    const tally = purchase.owned.has(pathKey(path)) ? withWeapon : counts;
    tally.set(node.itemId, (tally.get(node.itemId) ?? 0) + 1);
    if (!counts.has(node.itemId)) counts.set(node.itemId, 0);
  }
  let totalRUB = 0;
  let itemCount = 0;
  let unpricedCount = 0;
  const rows = order.map<ShoppingRow>((itemId) => {
    const item = lookup.get(itemId);
    const count = counts.get(itemId) ?? 0;
    const isWeapon = itemId === root.itemId && includeWeapon;
    const choice = count === 0 ? null : isWeapon ? purchase.weapon : item ? priceChoice(item, sources, limits) : null;
    const asPreset = isWeapon && context.preset ? purchase.asPreset : undefined;
    const trader = item ? traderQuote(item, limits, asPreset) : null;
    const flea = positive(item?.fleaPriceRUB);
    const source = choice?.source ?? null;
    const unit = choice?.priceRUB ?? null;
    const offer = choice && choice.source !== "flea" ? choice.offer : undefined;
    itemCount += count;
    if (unit === null) unpricedCount += count;
    else totalRUB += unit * count;
    const fromWeapon = withWeapon.get(itemId) ?? 0;
    return {
      itemId,
      name: item?.name ?? `Unknown item (${itemId})`,
      shortName: item?.shortName ?? itemId,
      normalizedName: item?.normalizedName ?? null,
      count,
      withWeapon: fromWeapon,
      isWeapon,
      traderPriceRUB: trader?.priceRUB ?? null,
      fleaPriceRUB: flea,
      traderName: trader?.trader ?? null,
      traderLevel: trader?.level ?? null,
      traderTask: trader?.task ?? null,
      source,
      ...(offer === undefined ? {} : { offer }),
      unitPriceRUB: unit,
      subtotalRUB: count === 0 ? 0 : unit === null ? null : unit * count,
    };
  });
  return { rows, totalRUB, itemCount, unpricedCount };
}

const NAME_WIDTH = 30;

function clean(value: string) {
  return value.replace(/[`\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
}

function defuseMentions(value: string) {
  return value.replace(/@/g, "@\u200b");
}

function fit(value: string, width: number) {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

function rub(value: number | null) {
  return value === null ? "-" : Math.round(value).toLocaleString("en-US");
}

function vendorOf(row: ShoppingRow) {
  if (row.count === 0 || row.unitPriceRUB === null) return "";
  if (row.source === "flea") return "Flea";
  const offer = row.offer;
  const seller = offer
    ? `${clean(traderLabel(offer.trader, offer.level))}${offer.preset ? " preset" : ""}`
    : row.source === "trader" && row.traderName
      ? clean(traderLabel(row.traderName, row.traderLevel))
      : "";
  return row.source === "barter" ? `${seller} barter ${rub(row.unitPriceRUB)}*`.trimStart() : seller;
}

export function formatShoppingList(
  list: ShoppingList,
  details: { buildName: string; weaponName: string | null; modeLabel: string }
): string {
  const vendors = list.rows.map(vendorOf);
  const showVendor = list.rows.some((row, index) => vendors[index] || row.withWeapon > 0);
  const title = [
    `**${escapeDiscordText(details.buildName) || "Untitled build"}**`,
    details.weaponName ? escapeDiscordText(details.weaponName) : null,
    `${details.modeLabel} prices`,
  ]
    .filter(Boolean)
    .join(" · ");
  const header = [
    fit("Part", NAME_WIDTH),
    "Qty".padStart(3),
    "Trader".padStart(10),
    "Flea".padStart(10),
    ...(showVendor ? ["  Vendor"] : []),
  ].join(" ");
  const lines = list.rows.map((row, index) => {
    const trader = `${rub(row.traderPriceRUB)}${row.source === "trader" ? "*" : " "}`;
    const flea = `${rub(row.fleaPriceRUB)}${row.source === "flea" ? "*" : " "}`;
    const vendor = [
      vendors[index],
      row.withWeapon > 0 ? `+${row.withWeapon} with weapon` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return [
      fit(clean(row.name), NAME_WIDTH),
      String(row.count).padStart(3),
      trader.padStart(10),
      flea.padStart(10),
      ...(showVendor ? [vendor ? `  ${vendor}` : ""] : []),
    ]
      .join(" ")
      .trimEnd();
  });
  const rule = "-".repeat(header.length);
  const unpriced =
    list.unpricedCount > 0
      ? ` (${list.unpricedCount} item${list.unpricedCount === 1 ? "" : "s"} without a price)`
      : "";
  return [
    title,
    "```",
    header,
    rule,
    ...lines,
    rule,
    `Total: ${rub(list.totalRUB)} RUB for ${list.itemCount} item${list.itemCount === 1 ? "" : "s"}${unpriced}`,
    "* = cheapest selected source",
    "```",
  ].join("\n");
}
