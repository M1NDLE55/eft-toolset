import { describe, expect, it } from "vitest";
import { placeCards, type CardBox } from "@/app/lib/item-views/placement";

const columnsOf = (placed: ReturnType<typeof placeCards>) => new Map([...placed].map(([id, place]) => [id, place.column]));

describe("placing item page cards", () => {
  const cards: CardBox[] = [
    { id: "a", span: 2, rows: 10 },
    { id: "b", span: 2, rows: 30 },
    { id: "c", span: 2, rows: 20 },
    { id: "d", span: 2, rows: 20 },
  ];

  it("puts each card where it can sit highest, leftmost on a tie", () => {
    const placed = placeCards(cards, 4);
    expect(placed.get("a")).toEqual({ column: 0, row: 0, span: 2, rows: 10 });
    expect(placed.get("b")).toEqual({ column: 2, row: 0, span: 2, rows: 30 });
    expect(placed.get("c")).toEqual({ column: 0, row: 10, span: 2, rows: 20 });
    // Under c (ends at 30) and b (ends at 30): leftmost.
    expect(placed.get("d")).toMatchObject({ column: 0, row: 30 });
  });

  it("keeps columns when a card grows, pushing only the cards below it down", () => {
    const first = placeCards(cards, 4);
    const grown = cards.map((card) => (card.id === "a" ? { ...card, rows: 60 } : card));
    // Re-choosing would move c beside b; kept columns leave it under a.
    expect(placeCards(grown, 4).get("c")!.column).toBe(2);
    const kept = placeCards(grown, 4, columnsOf(first));
    expect(columnsOf(kept)).toEqual(columnsOf(first));
    expect(kept.get("c")).toMatchObject({ column: 0, row: 60 });
    expect(kept.get("b")).toMatchObject({ column: 2, row: 0 });
  });

  it("chooses again for a card whose kept column no longer fits, and caps spans at the columns", () => {
    const placed = placeCards([{ id: "wide", span: 4, rows: 5 }, { id: "x", span: 2, rows: 5 }], 3, new Map([["x", 2]]));
    expect(placed.get("wide")).toMatchObject({ column: 0, span: 3 });
    expect(placed.get("x")).toMatchObject({ column: 0, row: 5 });
  });
});
