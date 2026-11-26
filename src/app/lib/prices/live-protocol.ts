// The live price socket's protocol: JSON text frames from the refresher (data-refresh-do.ts) on
// /api/prices/live?mode=<regular|pve>, one kind of message. Pages send only the text "ping", which
// the runtime answers "pong" without waking the refresher.

export const PRICE_SOCKET_PATH = "/api/prices/live";

/**
 * The refresher's state, sent when a page connects, when a check starts (`checking`), and when it
 * ends (with the new version if tarkov.dev published new prices).
 */
export interface PriceUpdate {
  type: "prices";
  /** The current price version; null until the refresher's first check. */
  version: number | null;
  /** When tarkov.dev published those prices (its Last-Modified), as an ISO time. */
  publishedAt: string | null;
  /** When the refresher last confirmed them with tarkov.dev, as an ISO time. */
  confirmedAt: string | null;
  /** A check with tarkov.dev is under way. */
  checking: boolean;
  /** The last check failed. */
  stale: boolean;
}

/** A frame from the socket, checked; null for anything else. */
export function parsePriceUpdate(text: unknown): PriceUpdate | null {
  if (typeof text !== "string" || text.length > 2_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  const version = message.version;
  if (message.type !== "prices" || typeof message.checking !== "boolean" || typeof message.stale !== "boolean") return null;
  if (version !== null && !(typeof version === "number" && Number.isSafeInteger(version) && version > 0)) return null;
  const time = (field: unknown) => field === null || (typeof field === "string" && field.length <= 40);
  if (!time(message.publishedAt) || !time(message.confirmedAt)) return null;
  return {
    type: "prices",
    version: version as number | null,
    publishedAt: message.publishedAt as string | null,
    confirmedAt: message.confirmedAt as string | null,
    checking: message.checking,
    stale: message.stale,
  };
}
