import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW_ID,
  ITEM_CARDS,
  PRESET_VIEWS,
  copyName,
  isItemView,
  moveCard,
  presetView,
  type ItemView,
} from "@/app/lib/item-views/views";
import { ITEM_VIEWS_STORE, copyView, deleteView, setActiveView, updateView } from "@/app/lib/item-views/store";
import { readStore } from "@/app/lib/storage/versioned-store";

const mine: ItemView = {
  id: "view-1",
  name: "Mine",
  cards: [
    { id: "per-slot", w: 2 },
    { id: "wiki-where", w: 4 },
  ],
};

describe("item page views", () => {
  it("has presets that each show everything the one before does, and more", () => {
    for (let index = 1; index < PRESET_VIEWS.length; index += 1) {
      const before = PRESET_VIEWS[index - 1].cards.map((entry) => entry.id);
      const after = new Set(PRESET_VIEWS[index].cards.map((entry) => entry.id));
      expect(before.every((id) => after.has(id)), PRESET_VIEWS[index].id).toBe(true);
      expect(after.size).toBeGreaterThan(before.length);
    }
    for (const view of PRESET_VIEWS) expect(view.cards.every((entry) => entry.id in ITEM_CARDS)).toBe(true);
  });

  it("rejects views with unknown or repeated cards, bad widths, or a preset's id", () => {
    expect(isItemView(mine)).toBe(true);
    expect(isItemView({ ...mine, id: "raid" })).toBe(false);
    expect(isItemView({ ...mine, name: " " })).toBe(false);
    expect(isItemView({ ...mine, cards: [{ id: "per-slot", w: 5 }] })).toBe(false);
    expect(isItemView({ ...mine, cards: [{ id: "gone", w: 1 }] })).toBe(false);
    expect(isItemView({ ...mine, cards: [mine.cards[0], mine.cards[0]] })).toBe(false);
  });

  it("moves a card to an index among the others", () => {
    const cards = presetView("raid")!.cards;
    expect(moveCard(cards, "buy-from", 0)[0].id).toBe("buy-from");
    expect(moveCard(cards, "best-sell", 99).at(-1)!.id).toBe("best-sell");
    expect(moveCard(cards, "best-sell", 99)).toHaveLength(cards.length);
  });

  it("names copies without clashing", () => {
    expect(copyName("Raid", [])).toBe("Raid (copy)");
    expect(copyName("Raid", [{ ...mine, name: "Raid (copy)" }])).toBe("Raid (copy 2)");
    expect(copyName("x".repeat(40), []).length).toBeLessThanOrEqual(32);
  });
});

describe("the item views store", () => {
  afterEach(() => localStorage.clear());

  it("copies a view, edits it, and goes back to the default when it's deleted", () => {
    const id = copyView(presetView("raid")!);
    expect(readStore(ITEM_VIEWS_STORE)).toMatchObject({ active: id, custom: [{ id, name: "Raid (copy)" }] });
    updateView(id, { cards: mine.cards, name: "Mine" });
    expect(readStore(ITEM_VIEWS_STORE).custom[0]).toEqual({ id, name: "Mine", cards: mine.cards });
    expect(() => updateView("raid", { name: "Nope" })).toThrow();
    setActiveView("full");
    deleteView(id);
    expect(readStore(ITEM_VIEWS_STORE)).toEqual({ active: "full", custom: [] });
    copyView(presetView("raid")!);
    deleteView("view-1");
    expect(readStore(ITEM_VIEWS_STORE).active).toBe(DEFAULT_VIEW_ID);
  });

  it("keeps saved views when a card they use is removed from the site", () => {
    localStorage.setItem(
      ITEM_VIEWS_STORE.key,
      JSON.stringify({ version: 1, data: { active: "view-1", custom: [{ ...mine, cards: [...mine.cards, { id: "gone", w: 1 }] }] } })
    );
    expect(readStore(ITEM_VIEWS_STORE)).toEqual({ active: "view-1", custom: [mine] });
  });
});
