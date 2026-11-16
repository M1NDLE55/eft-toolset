// Item page views: which cards an item page shows, in what order, and how wide.
// No React or browser APIs here: the server reads the active view from a cookie with these too.

export const CARD_GROUPS = ["Prices", "Item", "Uses", "Wiki"] as const;
export type CardGroup = (typeof CARD_GROUPS)[number];

/** Every card an item page can show. Order here is the order cards are offered when adding one. */
export const ITEM_CARDS = {
  "best-sell": { title: "Best sell", group: "Prices", width: 1, description: "The most you can sell it for." },
  "per-slot": { title: "Per slot", group: "Prices", width: 1, description: "Best sell price per inventory slot." },
  "flea-fee": { title: "Flea fee", group: "Prices", width: 1, description: "What listing at the lowest price costs." },
  "change-48h": { title: "48h change", group: "Prices", width: 1, description: "How the flea average moved." },
  "sell-to": { title: "Sell to", group: "Prices", width: 1, description: "Every trader and the flea market." },
  "buy-from": { title: "Buy from", group: "Prices", width: 1, description: "Traders and the flea market, cheapest first." },
  "price-history": { title: "Your price history", group: "Prices", width: 2, description: "Best sell as you've seen it." },
  "flea-market": { title: "Flea market", group: "Prices", width: 1, description: "24h low, high, listings and base price." },
  needs: { title: "Keep or sell", group: "Uses", width: 2, description: "How many tasks and the hideout need." },
  about: { title: "About", group: "Item", width: 2, description: "Description, weight, size and category." },
  tasks: { title: "Used in tasks", group: "Uses", width: 2, description: "Each task's objectives for the item." },
  hideout: { title: "Hideout", group: "Uses", width: 1, description: "Upgrades that need it." },
  "barters-using": { title: "Barters using", group: "Uses", width: 2, description: "Trades that take the item." },
  "crafts-using": { title: "Crafts using", group: "Uses", width: 2, description: "Crafts that take the item." },
  obtain: { title: "Ways to get it", group: "Uses", width: 2, description: "Barters and crafts that give the item." },
  "wiki-where": { title: "Where to find", group: "Wiki", width: 2, description: "Spawns, and for keys the lock, from the wiki." },
  "wiki-notes": { title: "Wiki notes", group: "Wiki", width: 2, description: "Notes, trivia and quest rewards from the wiki." },
} as const satisfies Record<string, { title: string; group: CardGroup; width: CardWidth; description: string }>;

export type ItemCardId = keyof typeof ITEM_CARDS;
export const CARD_WIDTHS = [1, 2, 3, 4] as const;
export type CardWidth = (typeof CARD_WIDTHS)[number];

export interface ViewCard {
  id: ItemCardId;
  /** Columns the card spans, of up to four; narrow screens have fewer. */
  w: CardWidth;
}

export interface ItemView {
  id: string;
  name: string;
  cards: ViewCard[];
}

export const MAX_CUSTOM_VIEWS = 12;
export const MAX_VIEW_NAME = 32;

export function isItemCardId(value: unknown): value is ItemCardId {
  return typeof value === "string" && Object.hasOwn(ITEM_CARDS, value);
}

function card(id: ItemCardId, w: CardWidth = ITEM_CARDS[id].width): ViewCard {
  return { id, w };
}

const RAID: ViewCard[] = [
  card("best-sell"),
  card("per-slot"),
  card("flea-fee"),
  card("change-48h"),
  card("needs"),
  card("sell-to"),
  card("buy-from"),
  card("price-history"),
];

const STANDARD: ViewCard[] = [
  ...RAID.slice(0, 4),
  card("needs"),
  card("about"),
  card("sell-to"),
  card("buy-from"),
  card("flea-market"),
  card("price-history"),
  card("tasks"),
  card("hideout"),
  card("obtain"),
  card("barters-using"),
  card("crafts-using"),
];

const FULL: ViewCard[] = [
  ...STANDARD.slice(0, 6),
  card("wiki-where"),
  card("wiki-notes"),
  ...STANDARD.slice(6),
];

/** Built-in views, each showing more than the one before. */
export const PRESET_VIEWS: readonly ItemView[] = [
  { id: "raid", name: "Raid", cards: RAID },
  { id: "standard", name: "Standard", cards: STANDARD },
  { id: "full", name: "Full", cards: FULL },
];

export const PRESET_DESCRIPTIONS: Record<string, string> = {
  raid: "Prices and whether to keep it: what you need mid-raid.",
  standard: "Adds the item's details, uses, and ways to get it.",
  full: "Adds where to find it and notes from the wiki.",
};

export const DEFAULT_VIEW_ID = "standard";

export function presetView(id: string) {
  return PRESET_VIEWS.find((view) => view.id === id);
}

export function isPresetId(id: string) {
  return presetView(id) !== undefined;
}

export function isViewCards(value: unknown): value is ViewCard[] {
  if (!Array.isArray(value) || value.length > Object.keys(ITEM_CARDS).length) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return false;
    const { id, w } = entry as Partial<ViewCard>;
    if (!isItemCardId(id) || seen.has(id) || !CARD_WIDTHS.includes(w as CardWidth)) return false;
    seen.add(id);
  }
  return true;
}

/** A stored view without cards the site no longer has, or undefined when it can't be saved as one. */
export function recoverItemView(value: unknown): ItemView | undefined {
  if (!value || typeof value !== "object") return undefined;
  const view = value as { cards?: unknown };
  const cards = Array.isArray(view.cards)
    ? view.cards.filter((entry) => entry && typeof entry === "object" && isItemCardId((entry as ViewCard).id))
    : view.cards;
  const recovered = { ...(value as object), cards };
  return isItemView(recovered) ? recovered : undefined;
}

export function isItemView(value: unknown): value is ItemView {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<ItemView>;
  return (
    typeof view.id === "string" &&
    /^[a-z0-9-]{1,40}$/.test(view.id) &&
    !isPresetId(view.id) &&
    typeof view.name === "string" &&
    view.name.trim().length > 0 &&
    view.name.length <= MAX_VIEW_NAME &&
    isViewCards(view.cards)
  );
}

// The cookie carries the active view, so the server renders the page as it will look: a preset's
// id, or "c:", the custom view's id, "|", and each card as "id.width", comma-separated.
export const ITEM_VIEW_COOKIE = "eft-item-view";
const MAX_COOKIE_LENGTH = 1_000;

export interface ActiveLayout {
  id: string;
  cards: ViewCard[];
}

export function encodeViewCookie(view: ItemView): string {
  if (isPresetId(view.id)) return view.id;
  return `c:${view.id}|${view.cards.map((entry) => `${entry.id}.${entry.w}`).join(",")}`;
}

/** The view the cookie names, or the default view when it's missing or can't be read. */
export function decodeViewCookie(value: string | undefined | null): ActiveLayout {
  const fallback = presetView(DEFAULT_VIEW_ID)!;
  if (!value || value.length > MAX_COOKIE_LENGTH) return fallback;
  const preset = presetView(value);
  if (preset) return preset;
  const match = /^c:([a-z0-9-]{1,40})\|(.*)$/.exec(value);
  if (!match || isPresetId(match[1])) return fallback;
  const cards = match[2]
    ? match[2]
        .split(",")
        .map((part) => {
          const at = part.lastIndexOf(".");
          return { id: part.slice(0, at), w: Number(part.slice(at + 1)) };
        })
        // A card since removed from the site drops out rather than spoiling the view.
        .filter((entry) => isItemCardId(entry.id))
    : [];
  return isViewCards(cards) ? { id: match[1], cards } : fallback;
}

/** Moves a card to a new index. */
export function moveCard(cards: readonly ViewCard[], id: ItemCardId, to: number): ViewCard[] {
  const from = cards.findIndex((entry) => entry.id === id);
  if (from < 0) return [...cards];
  const next = [...cards];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

export function newViewId(existing: readonly ItemView[]) {
  for (let index = 1; ; index += 1) {
    const id = `view-${index}`;
    if (!existing.some((view) => view.id === id)) return id;
  }
}

/** "Raid (copy)", then "Raid (copy 2)" and so on, within the name limit. */
export function copyName(name: string, existing: readonly ItemView[]) {
  const taken = new Set(existing.map((view) => view.name));
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? " (copy)" : ` (copy ${index})`;
    const candidate = `${name.slice(0, MAX_VIEW_NAME - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
