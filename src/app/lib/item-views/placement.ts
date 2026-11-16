// Where each item page card sits in the grid. Rows are small fixed units; a card spans as many as
// its content needs. Columns are chosen once per layout (view, order, widths, column count) and
// then kept, so a card growing only pushes down the cards below it in the same columns: nothing
// jumps sideways because something above it opened.

export interface CardBox {
  id: string;
  /** Columns the card spans, already capped at the grid's columns. */
  span: number;
  /** Rows the card's content needs. */
  rows: number;
}

export interface Placement {
  /** First column, from 0. */
  column: number;
  /** First row, from 0. */
  row: number;
  span: number;
  rows: number;
}

/**
 * Places cards in order. A card without a kept column takes the one where it can sit highest,
 * leftmost on a tie; every card sits just below the cards already placed in its columns.
 */
export function placeCards(
  cards: readonly CardBox[],
  columns: number,
  kept: ReadonlyMap<string, number> = new Map()
): Map<string, Placement> {
  const bottoms = new Array<number>(columns).fill(0);
  const top = (column: number, span: number) => Math.max(...bottoms.slice(column, column + span));
  const placed = new Map<string, Placement>();
  for (const card of cards) {
    const span = Math.max(1, Math.min(card.span, columns));
    let column = kept.get(card.id);
    if (column === undefined || column < 0 || column + span > columns) {
      column = 0;
      for (let candidate = 1; candidate + span <= columns; candidate += 1) {
        if (top(candidate, span) < top(column, span)) column = candidate;
      }
    }
    const row = top(column, span);
    for (let index = column; index < column + span; index += 1) bottoms[index] = row + card.rows;
    placed.set(card.id, { column, row, span, rows: card.rows });
  }
  return placed;
}
