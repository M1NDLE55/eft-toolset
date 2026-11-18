import type { ItemsNeeded, NeededChoice } from "./items-needed";

/** Money handed over to traders: worth totalling, not shopping for. */
export const CURRENCY_ITEMS: Readonly<Record<string, string>> = {
  "5449016a4bdc2d6f028b456f": "Roubles",
  "5696686a4bdc2da3298b456a": "Dollars",
  "569668774bdc2da2298b4568": "Euros",
};

export interface ShoppingRow {
  id: string;
  count: number;
  /** The quests that need it this way, and how many each. */
  quests: { id: string; count: number }[];
}

export interface ShoppingList {
  /** Items that must be found in raid. */
  foundInRaid: ShoppingRow[];
  /** Items from anywhere: bought, crafted or found. */
  other: ShoppingRow[];
  money: ShoppingRow[];
  /** Needs any one of several items meets. */
  choices: NeededChoice[];
  /** See `ItemsNeeded.factionVersions`. */
  factionVersions: boolean;
}

/**
 * Splits the items needed into what must be found in raid and what can come from anywhere,
 * the most needed first, with money apart. An item needed both ways appears in both.
 */
export function shoppingList(needed: ItemsNeeded): ShoppingList {
  const foundInRaid: ShoppingRow[] = [];
  const other: ShoppingRow[] = [];
  const money: ShoppingRow[] = [];
  for (const item of needed.items) {
    const rows = (fir: boolean) =>
      item.quests.filter((entry) => entry.foundInRaid === fir).map((entry) => ({ id: entry.id, count: entry.count }));
    if (Object.hasOwn(CURRENCY_ITEMS, item.id)) {
      money.push({ id: item.id, count: item.foundInRaid + item.other, quests: [...rows(true), ...rows(false)] });
      continue;
    }
    if (item.foundInRaid > 0) foundInRaid.push({ id: item.id, count: item.foundInRaid, quests: rows(true) });
    if (item.other > 0) other.push({ id: item.id, count: item.other, quests: rows(false) });
  }
  const byCount = (a: ShoppingRow, b: ShoppingRow) => b.count - a.count || a.id.localeCompare(b.id);
  return { foundInRaid: foundInRaid.sort(byCount), other: other.sort(byCount), money: money.sort(byCount), choices: needed.choices, factionVersions: needed.factionVersions };
}

const MONEY_SYMBOL: Readonly<Record<string, string>> = {
  "5449016a4bdc2d6f028b456f": " ₽",
  "5696686a4bdc2da3298b456a": "$",
  "569668774bdc2da2298b4568": "€",
};

/** "50,000 ₽", "$1,000" or "€450" for money; null for any other item. */
export function moneyLabel(id: string, count: number) {
  if (!Object.hasOwn(MONEY_SYMBOL, id)) return null;
  const amount = Math.round(count).toLocaleString("en-US");
  const symbol = MONEY_SYMBOL[id];
  return symbol.startsWith(" ") ? `${amount}${symbol}` : `${symbol}${amount}`;
}
