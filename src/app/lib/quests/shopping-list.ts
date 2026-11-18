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
  return { foundInRaid: foundInRaid.sort(byCount), other: other.sort(byCount), money: money.sort(byCount), choices: needed.choices };
}
