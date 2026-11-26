import type { GameMode } from "@/components/game-mode/context";
import { platform, sharedAcrossRequests } from "@/app/lib/server/platform";
import { canonicalJson, TARKOV_OPERATIONS } from "./operations";
import { isPriceVersion } from "@/app/lib/prices/live-input";
import { devTimeScale, priceFeedStoreKey, refresher } from "./refresher";
import { USER_AGENT } from "./user-agent";

// The price feed: the part of tarkov.dev's items file that changes every few minutes (flea and trader
// prices). In the Worker, the refresher (data-refresh-do.ts, one per game mode) builds it when
// tarkov.dev publishes new prices and hands it to the instances that ask, so no isolate downloads the
// whole items file for prices; a cold isolate starts from the copy in KV. Locally, PRICE_FEED_ORIGIN
// can name an origin serving the `price.feed` GET instead. See DATA_ARCHITECTURE.md ("Price feed").

/** Bumped when the wire format changes; a copy in another format is refused, and reads use the items file. */
export const PRICE_FEED_FORMAT = 2;
/** From an origin that doesn't predict tarkov.dev's next change (PRICE_FEED_ORIGIN), a copy is current this long. */
export const FEED_FRESH_MS = 60_000;
/** An instance asks the refresher at most this often when it predicts, and for a newer version (`p`) at most this often. */
const MIN_ASK_INTERVAL_MS = 5_000 / devTimeScale();
/** A read that needs a newer version than the copy (a page refetching after a push) waits this long for it at most. */
const NEWER_VERSION_WAIT_MS = 5_000;
// A CDN miss can wait on the origin revalidating the items file (up to PRICE_FEED_ORIGIN_WAIT_MS), then building the feed.
const FEED_TIMEOUT_MS = 10_000;
// The feed is about 1.3 MB of JSON.
const FEED_MAX_BYTES = 8 * 1024 * 1024;
const MAX_FEED_ITEMS = 100_000;
const MAX_FEED_TRADERS = 1_000;
const MAX_OFFER_FIELDS = 4_000;
const MAX_ID_LENGTH = 64;
// As for tarkov.dev: after a failed refresh the feed isn't asked again for 10 seconds, doubling to
// 10 minutes, with jitter, or for as long as a Retry-After asks (up to an hour). Reads meanwhile use
// the items file, at once and without a request.
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 10 * 60_000;
const RETRY_AFTER_MAX_MS = 60 * 60_000;

export interface TraderPrice {
  trader: string;
  priceRUB: number | null;
}

export interface TraderBuyPrice extends TraderPrice {
  minTraderLevel: number | null;
  /** The task that unlocks the offer. */
  taskUnlock: string | null;
}

/** One item's prices: every field the item projections read that changes with the market. */
export interface ItemPrices {
  lastLowPrice: number | null;
  avg24hPrice: number | null;
  low24hPrice: number | null;
  high24hPrice: number | null;
  lastOfferCount: number | null;
  changeLast48hPercent: number | null;
  updated: string | null;
  sellToTrader: TraderPrice[];
  buyFromTrader: TraderBuyPrice[];
}

/** An item from tarkov.dev's items file, as far as the feed reads it. */
export interface PricedItem {
  id?: string;
  lastLowPrice?: number | null;
  avg24hPrice?: number | null;
  low24hPrice?: number | null;
  high24hPrice?: number | null;
  lastOfferCount?: number | null;
  changeLast48hPercent?: number | null;
  updated?: string | null;
  sellToTrader?: { trader?: string; priceRUB?: number | null }[] | null;
  buyFromTrader?: { trader?: string; priceRUB?: number | null; minTraderLevel?: number | null; taskUnlock?: string | null }[] | null;
}

export type FeedSource = "tarkov.dev" | "deployment";

/** What the origin knew about the items copy it built the feed from. */
export interface PriceFeedHeader {
  gameMode: GameMode;
  /** Rises each time tarkov.dev publishes new prices: what live pages compare (see live-prices.ts). */
  version: number;
  /** When the refresher next expects tarkov.dev to have newer prices; null from an origin that doesn't predict. */
  nextCheckAt: number | null;
  /** When the origin last confirmed its items copy with tarkov.dev (or the build fetched it). */
  fetchedAt: number;
  source: FeedSource;
  /** The origin's refresh of the items copy failed or was slow, so the copy is older than it should be. */
  stale: boolean;
  /** The items copy's ETag and Last-Modified from json.tarkov.dev. */
  etag: string | null;
  lastModified: string | null;
}

/**
 * Per item: [id, lastLowPrice, avg24hPrice, low24hPrice, high24hPrice, lastOfferCount, changeLast48hPercent,
 * updated, sell, buy]. sell is flat [trader, priceRUB, ...] and buy flat [trader, priceRUB, minTraderLevel,
 * taskUnlock, ...], with traders as indexes into `traders`.
 */
type FeedRow = [
  string,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  string | null,
  (number | null)[],
  (number | string | null)[],
];

export interface PriceFeedRows {
  traders: string[];
  items: FeedRow[];
}

export interface PriceFeedWire extends PriceFeedHeader, PriceFeedRows {
  format: number;
}

export interface PriceFeed extends PriceFeedHeader {
  prices: ReadonlyMap<string, ItemPrices>;
}

const PRICE_FIELDS = ["lastLowPrice", "avg24hPrice", "low24hPrice", "high24hPrice", "lastOfferCount", "changeLast48hPercent"] as const;

/** The feed's rows for every item with an id, priced or not, so readers can tell which items exist. */
export function projectPriceRows(items: Iterable<PricedItem>): PriceFeedRows {
  const traders: string[] = [];
  const traderIndex = new Map<string, number>();
  const indexOf = (trader: string) => {
    let index = traderIndex.get(trader);
    if (index === undefined) {
      index = traders.push(trader) - 1;
      traderIndex.set(trader, index);
    }
    return index;
  };
  const rows: FeedRow[] = [];
  for (const item of items) {
    if (!item.id) continue;
    const sell = (item.sellToTrader ?? []).flatMap((offer) =>
      offer.trader ? [indexOf(offer.trader), finiteOrNull(offer.priceRUB)] : []
    );
    const buy = (item.buyFromTrader ?? []).flatMap((offer) =>
      offer.trader
        ? [indexOf(offer.trader), finiteOrNull(offer.priceRUB), finiteOrNull(offer.minTraderLevel), offer.taskUnlock || null]
        : []
    );
    rows.push([
      item.id,
      ...(PRICE_FIELDS.map((field) => finiteOrNull(item[field])) as [number | null, number | null, number | null, number | null, number | null, number | null]),
      typeof item.updated === "string" ? item.updated : null,
      sell,
      buy,
    ]);
  }
  return { traders, items: rows };
}

/** The feed in a response, checked strictly; null when anything about it is off. */
export function parsePriceFeed(value: unknown, gameMode: GameMode): PriceFeed | null {
  if (!isRecord(value) || value.format !== PRICE_FEED_FORMAT || value.gameMode !== gameMode) return null;
  const { version, nextCheckAt, fetchedAt, source, stale, etag, lastModified, traders, items } = value;
  if (!isPriceVersion(version)) return null;
  if (nextCheckAt !== null && (typeof nextCheckAt !== "number" || !Number.isFinite(nextCheckAt))) return null;
  if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
  if ((source !== "tarkov.dev" && source !== "deployment") || typeof stale !== "boolean") return null;
  if (!nullableText(etag, 200) || !nullableText(lastModified, 100)) return null;
  if (!Array.isArray(traders) || traders.length > MAX_FEED_TRADERS || !traders.every(isId)) return null;
  if (!Array.isArray(items) || items.length > MAX_FEED_ITEMS) return null;
  const traderAt = (index: unknown) =>
    Number.isInteger(index) && (index as number) >= 0 && (index as number) < traders.length ? (traders[index as number] as string) : null;
  const prices = new Map<string, ItemPrices>();
  for (const row of items) {
    if (!Array.isArray(row) || row.length !== 10 || !isId(row[0]) || prices.has(row[0])) return null;
    const numbers = row.slice(1, 7);
    if (!numbers.every(isFiniteOrNull) || !nullableText(row[7], 64)) return null;
    const sell = row[8];
    const buy = row[9];
    if (!Array.isArray(sell) || sell.length % 2 !== 0 || sell.length > MAX_OFFER_FIELDS) return null;
    if (!Array.isArray(buy) || buy.length % 4 !== 0 || buy.length > MAX_OFFER_FIELDS) return null;
    const sellToTrader: TraderPrice[] = [];
    for (let i = 0; i < sell.length; i += 2) {
      const trader = traderAt(sell[i]);
      if (!trader || !isFiniteOrNull(sell[i + 1])) return null;
      sellToTrader.push({ trader, priceRUB: sell[i + 1] as number | null });
    }
    const buyFromTrader: TraderBuyPrice[] = [];
    for (let i = 0; i < buy.length; i += 4) {
      const trader = traderAt(buy[i]);
      const taskUnlock = buy[i + 3];
      if (!trader || !isFiniteOrNull(buy[i + 1]) || !isFiniteOrNull(buy[i + 2]) || !(taskUnlock === null || isId(taskUnlock))) {
        return null;
      }
      buyFromTrader.push({
        trader,
        priceRUB: buy[i + 1] as number | null,
        minTraderLevel: buy[i + 2] as number | null,
        taskUnlock: taskUnlock as string | null,
      });
    }
    const [lastLowPrice, avg24hPrice, low24hPrice, high24hPrice, lastOfferCount, changeLast48hPercent] = numbers as (number | null)[];
    prices.set(row[0], {
      lastLowPrice,
      avg24hPrice,
      low24hPrice,
      high24hPrice,
      lastOfferCount,
      changeLast48hPercent,
      updated: row[7] as string | null,
      sellToTrader,
      buyFromTrader,
    });
  }
  return {
    gameMode,
    version: version as number,
    nextCheckAt: nextCheckAt as number | null,
    fetchedAt,
    source,
    stale,
    etag: (etag as string | null) ?? null,
    lastModified: (lastModified as string | null) ?? null,
    prices,
  };
}

/** For an item the feed doesn't list: tarkov.dev no longer prices it. */
export const NO_PRICES: ItemPrices = Object.freeze({
  lastLowPrice: null,
  avg24hPrice: null,
  low24hPrice: null,
  high24hPrice: null,
  lastOfferCount: null,
  changeLast48hPercent: null,
  updated: null,
  sellToTrader: [],
  buyFromTrader: [],
});

export { isPriceVersion };

/** The version of a feed from an origin without a refresher: tarkov.dev's Last-Modified, else when it was fetched. */
export function priceVersionOf(lastModified: string | null | undefined, fetchedAt: number) {
  const time = lastModified ? Date.parse(lastModified) : Number.NaN;
  return Math.max(1, Math.floor(Number.isFinite(time) ? time : fetchedAt));
}

/** Stands for the refresher as the feed's origin. */
export const REFRESHER_FEED_ORIGIN = "refresher:";

/**
 * Where instances get the feed: the refresher in the Worker, or PRICE_FEED_ORIGIN locally. Off
 * anywhere else; reads then use the items file.
 */
export function priceFeedOrigin(): string | null {
  if (platform().refresher) return REFRESHER_FEED_ORIGIN;
  const local = process.env.PRICE_FEED_ORIGIN?.trim();
  if (!local) return null;
  try {
    const url = new URL(local);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function priceFeedUrl(origin: string, gameMode: GameMode) {
  const variables = encodeURIComponent(canonicalJson({ gameMode }));
  return `${origin}/api/tarkov?op=${TARKOV_OPERATIONS.priceFeed}&v=${variables}`;
}

/** This instance's copy of one mode's feed and the state of its refreshes. */
interface FeedState {
  feed?: PriceFeed;
  /** When this instance last got the feed from our origin. */
  checkedAt: number;
  /** Until then the copy is current: the origin doesn't expect newer prices before it. */
  nextAskAt: number;
  /** When a read last asked because it needed a newer version than the copy. */
  newerAskedAt: number;
  /** A cold instance's read of the copy in KV, once. */
  storedRead?: Promise<void>;
  inFlight?: Promise<void>;
  /** A caller gave up waiting for the refresh in flight, so later ones don't wait for it either. */
  slowRefresh?: boolean;
  failures: number;
  failedAt?: number;
  retryAt?: number;
  lastError?: string;
}

// Shared through globalThis like the resource cache, since this module is bundled into several chunks.
const STATE_KEY = "__eftPriceFeed:1";
const feedStates = ((globalThis as typeof globalThis & { [STATE_KEY]?: Map<GameMode, FeedState> })[STATE_KEY] ??= new Map());

function stateOf(gameMode: GameMode) {
  let state = feedStates.get(gameMode);
  if (!state) feedStates.set(gameMode, (state = { checkedAt: 0, nextAskAt: 0, newerAskedAt: 0, failures: 0 }));
  return state;
}

export interface PriceFeedRead {
  /** The newest copy this instance holds, if any. */
  feed?: PriceFeed;
  /** The copy is older than it should be: its refresh failed or didn't arrive within the wait. */
  stale: boolean;
  /** The feed can't be reached right now: the read should look to the items file for newer prices. */
  failing: boolean;
}

/**
 * This instance's feed copy for the mode. A copy is served at once, never waiting for a refresh: once
 * the origin's predicted change is due, it is asked in the background, and pages that are open learn
 * of new prices from the refresher's push (live-prices.ts). Only a read with no copy at all waits, up
 * to waitMs; one that needs at least `minVersion` (a page refetching after a push) waits up to a few
 * seconds for it. Null when the feed is off here.
 */
export async function readPriceFeed(gameMode: GameMode, waitMs: number, minVersion?: number): Promise<PriceFeedRead | null> {
  const origin = priceFeedOrigin();
  if (!origin) return null;
  const state = stateOf(gameMode);
  if (!state.feed && origin === REFRESHER_FEED_ORIGIN) await readStoredFeed(gameMode, state);
  const now = Date.now();
  const behind = () => minVersion !== undefined && (!state.feed || state.feed.version < minVersion);
  const wantsNewer = behind();
  const due = now >= state.nextAskAt;
  if (state.feed && !due && !wantsNewer) return { feed: state.feed, stale: false, failing: false };
  if (!due && wantsNewer && state.feed && !state.inFlight) {
    // A version newer than any the origin knows (a made-up `p`) mustn't make every read ask again.
    if (now - state.newerAskedAt < MIN_ASK_INTERVAL_MS) return { feed: state.feed, stale: true, failing: false };
    state.newerAskedAt = now;
  }
  const refresh = refreshPriceFeed(origin, gameMode, state);
  refresh.catch(() => undefined);
  if (state.failures > 0) return { feed: state.feed, stale: true, failing: true };
  if (state.feed && !wantsNewer) return { feed: state.feed, stale: false, failing: false };
  const limit = state.feed ? Math.min(waitMs, NEWER_VERSION_WAIT_MS) : waitMs;
  const wait = state.slowRefresh && Number.isFinite(limit) ? 0 : limit;
  if (wait > 0 && (await settled(refresh, wait))) return { feed: state.feed, stale: behind(), failing: false };
  if (state.failures > 0) return { feed: state.feed, stale: true, failing: true };
  if (wait > 0 && state.inFlight) state.slowRefresh = true;
  return { feed: state.feed, stale: true, failing: false };
}

/** Whether a result built from this feed copy can stand in for a fresh read. A due copy starts refreshing. */
export function isCurrentPriceFeed(gameMode: GameMode, feed: unknown) {
  const state = feedStates.get(gameMode);
  const origin = priceFeedOrigin();
  if (!origin || !state || state.feed !== feed || state.failures > 0) return false;
  if (Date.now() >= state.nextAskAt) refreshPriceFeed(origin, gameMode, state).catch(() => undefined);
  return true;
}

/** A cold instance's first copy: the one the refresher last wrote to KV, read once. A miss leaves it to the refresher. */
function readStoredFeed(gameMode: GameMode, state: FeedState) {
  state.storedRead ??= sharedAcrossRequests(
    (async () => {
      const store = platform().sharedStore;
      const body = store ? await store.get(priceFeedStoreKey(gameMode, PRICE_FEED_FORMAT)).catch(() => null) : null;
      if (body === null || body.length > FEED_MAX_BYTES || state.feed) return;
      const feed = parseFeedBody(body, gameMode);
      if (!feed) return;
      state.feed = feed;
      // Its prediction may have passed long ago; then the first read asks the refresher.
      state.nextAskAt = feed.nextCheckAt ?? 0;
    })().catch(() => undefined)
  );
  return state.storedRead;
}

/** Refreshes the copy, sharing one request among callers; rejects at once while waiting out a failure. */
function refreshPriceFeed(origin: string, gameMode: GameMode, state: FeedState): Promise<void> {
  if (state.inFlight) return state.inFlight;
  if (state.retryAt !== undefined && state.retryAt > Date.now()) {
    return Promise.reject(new PriceFeedError("The price feed will be retried shortly."));
  }
  const inFlight = fetchPriceFeed(origin, gameMode, state.feed)
    .then((feed) => {
      const held = state.feed;
      if (held && feed.version === held.version && feed.etag === held.etag && feed.lastModified === held.lastModified) {
        // The same prices: keep the held copy, so everything built from it stays valid, and note
        // when it was confirmed.
        held.fetchedAt = feed.fetchedAt;
        held.source = feed.source;
        held.stale = feed.stale;
        held.nextCheckAt = feed.nextCheckAt;
      } else if (!held || feed.version >= held.version) {
        state.feed = feed;
      }
      const now = Date.now();
      state.checkedAt = now;
      state.nextAskAt = Math.max(feed.nextCheckAt ?? now + FEED_FRESH_MS, now + MIN_ASK_INTERVAL_MS);
      state.failures = 0;
      state.failedAt = state.retryAt = state.lastError = undefined;
    })
    .catch((error: unknown) => {
      const now = Date.now();
      state.failures += 1;
      state.failedAt = now;
      state.retryAt = now + retryDelay(state.failures, error);
      state.lastError = error instanceof Error ? error.message : String(error);
      if (state.failures === 1) console.warn(`The ${gameMode} price feed failed; reads use the items file meanwhile. ${state.lastError}`);
      throw error;
    })
    .finally(() => {
      state.inFlight = undefined;
      state.slowRefresh = undefined;
    });
  state.inFlight = sharedAcrossRequests(inFlight);
  return inFlight;
}

export class PriceFeedError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "PriceFeedError";
  }
}

function retryDelay(failures: number, error: unknown) {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failures - 1, 10));
  const jittered = backoff * (0.8 + Math.random() * 0.4);
  const requested = error instanceof PriceFeedError ? (error.retryAfterMs ?? 0) : 0;
  return Math.max(jittered, Math.min(requested, RETRY_AFTER_MAX_MS));
}

/** A feed body (`{"data": …}`, as `price.feed` answers and the refresher writes), checked; null when anything is off. */
export function parseFeedBody(body: string, gameMode: GameMode): PriceFeed | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsePriceFeed(isRecord(parsed) ? parsed.data : undefined, gameMode);
  } catch {
    return null;
  }
}

/** The current feed from the refresher, which checks tarkov.dev first if a check is due. */
async function askRefresher(gameMode: GameMode, held: PriceFeed | undefined): Promise<PriceFeed> {
  const service = refresher(gameMode);
  if (!service) throw new PriceFeedError("The refresher isn't available.");
  let answer;
  try {
    answer = await service.prices(gameMode, held?.version ?? null);
  } catch (error) {
    throw new PriceFeedError(`The refresher couldn't be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (answer.version === null) throw new PriceFeedError("The price feed hasn't been published yet.");
  let feed: PriceFeed | null;
  if (answer.body !== undefined) {
    if (answer.body.length > FEED_MAX_BYTES) throw new PriceFeedError("The price feed is oversized.");
    feed = parseFeedBody(answer.body, gameMode);
    if (!feed) throw new PriceFeedError("The price feed has data in an unexpected shape.");
  } else if (held && held.version === answer.version) {
    feed = { ...held };
  } else {
    throw new PriceFeedError("The refresher sent no feed.");
  }
  // The body was written when the prices changed: its confirmation and prediction are the answer's.
  return { ...feed, fetchedAt: answer.confirmedAt, nextCheckAt: answer.nextCheckAt, stale: answer.stale };
}

async function fetchPriceFeed(origin: string, gameMode: GameMode, held: PriceFeed | undefined): Promise<PriceFeed> {
  if (origin === REFRESHER_FEED_ORIGIN) return askRefresher(gameMode, held);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "br, gzip",
    "User-Agent": USER_AGENT,
  };
  try {
    // The feed URL never redirects.
    const response = await fetch(priceFeedUrl(origin, gameMode), {
      headers,
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new PriceFeedError(`The price feed returned ${response.status}.`, retryAfterMs(response.headers.get("retry-after")));
    }
    const body = await readTextWithLimit(response);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new PriceFeedError("The price feed returned invalid JSON.");
    }
    const feed = parsePriceFeed(isRecord(parsed) ? parsed.data : undefined, gameMode);
    if (!feed) throw new PriceFeedError("The price feed returned data in an unexpected shape.");
    return feed;
  } catch (error) {
    if (controller.signal.aborted) throw new PriceFeedError("The price feed timed out.");
    if (error instanceof PriceFeedError) throw error;
    throw new PriceFeedError(`The price feed failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readTextWithLimit(response: Response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > FEED_MAX_BYTES) throw new PriceFeedError("The price feed is oversized.");
  if (!response.body) throw new PriceFeedError("The price feed was empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > FEED_MAX_BYTES) {
        await reader.cancel();
        throw new PriceFeedError("The price feed is oversized.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    throw error instanceof PriceFeedError ? error : new PriceFeedError("The price feed couldn't be read.");
  } finally {
    reader.releaseLock();
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** True if the promise fulfils within ms (or at all, for Infinity). */
function settled(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const done = promise.then(() => true, () => false);
  if (!Number.isFinite(ms)) return done;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([done, new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms)))]).finally(() =>
    clearTimeout(timer)
  );
}

export interface PriceFeedStatus {
  gameMode: GameMode;
  enabled: boolean;
  loaded: boolean;
  /** When the origin last confirmed the prices with tarkov.dev, as an ISO time. */
  asOf: string | null;
  ageSeconds: number | null;
  state: "off" | "not loaded" | "fresh" | "refreshing" | "due" | "failing";
  lastError: string | null;
  retryAfterSeconds: number | null;
}

/** What this instance holds of the feed. Makes no requests. */
export function priceFeedStatus(gameModes: readonly GameMode[] = ["regular", "pve"]): PriceFeedStatus[] {
  const now = Date.now();
  const enabled = priceFeedOrigin() !== null;
  return gameModes.map((gameMode) => {
    const state = feedStates.get(gameMode);
    const feed = state?.feed;
    const retryIn = state?.retryAt !== undefined && state.retryAt > now ? state.retryAt - now : null;
    return {
      gameMode,
      enabled,
      loaded: feed !== undefined,
      asOf: feed ? new Date(feed.fetchedAt).toISOString() : null,
      ageSeconds: feed ? Math.max(0, Math.round((now - feed.fetchedAt) / 1000)) : null,
      state: !enabled
        ? "off"
        : state?.failures
          ? "failing"
          : state?.inFlight
            ? "refreshing"
            : !feed
              ? "not loaded"
              : now < state!.nextAskAt
                ? "fresh"
                : "due",
      lastError: state?.lastError ?? null,
      retryAfterSeconds: retryIn === null ? null : Math.ceil(retryIn / 1000),
    };
  });
}

/** The newest feed copy this instance holds for the mode, without refreshing it. */
export function latestPriceFeed(gameMode: GameMode): PriceFeed | undefined {
  return priceFeedOrigin() ? feedStates.get(gameMode)?.feed : undefined;
}

/** The feed refreshes in flight. For tests. */
export function priceFeedRefreshes(): Promise<void>[] {
  return [...feedStates.values()].flatMap((state) => (state.inFlight ? [state.inFlight] : []));
}

export function clearPriceFeedCache() {
  feedStates.clear();
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isFiniteOrNull(value: unknown) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function nullableText(value: unknown, maxLength: number) {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
