export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  /** Where the card sits against the link. */
  side: "below" | "above";
  /** The tallest the card may be without leaving the screen. */
  maxHeight: number;
}

/** Space kept between the card and the screen's edges, and between the card and its link. */
export const EDGE = 8;
export const GAP = 6;

/**
 * Where to put a card anchored to a link: below it when it fits (or below has the most room), above
 * otherwise, moved sideways and capped in height to stay on screen.
 */
export function placeCard(anchor: Box, card: { width: number; height: number }, viewport: { width: number; height: number }): Placement {
  const below = viewport.height - (anchor.top + anchor.height) - GAP - EDGE;
  const above = anchor.top - GAP - EDGE;
  const side = card.height <= below || below >= above ? "below" : "above";
  const room = Math.max(0, side === "below" ? below : above);
  const height = Math.min(card.height, room);
  const top = side === "below" ? anchor.top + anchor.height + GAP : anchor.top - GAP - height;
  const width = Math.min(card.width, viewport.width - 2 * EDGE);
  const left = Math.min(Math.max(anchor.left, EDGE), Math.max(EDGE, viewport.width - EDGE - width));
  return { top: Math.max(EDGE, top), left, side, maxHeight: room };
}
