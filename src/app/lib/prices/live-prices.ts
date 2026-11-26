import { useCallback, useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import { useRouter } from "@tanstack/react-router";
import { GAME_MODE_COOKIE, isGameMode, type GameMode } from "@/components/game-mode/mode";
import { useGameMode } from "@/components/game-mode/context";
import { parsePriceUpdate, PRICE_SOCKET_PATH, type PriceUpdate } from "./live-protocol";

// Live prices in the browser. A page that shows prices opens the game mode's price socket (one per
// mode, shared by everything on the page) and learns from the refresher when a check starts and
// which price version is current. When that is newer than the version the page shows, the page
// refetches just its own data for that version (`p`; each version is its own edge cache entry), and
// the header says "Updating prices" meanwhile. If the socket can't open (old browser, blocked, the
// refresher busy) nothing changes: the page keeps the prices it has. See DATA_ARCHITECTURE.md
// ("Live prices").

const PING_INTERVAL_MS = 30_000;
/** A hidden tab's socket closes after this, so a forgotten tab doesn't keep the refresher checking. */
const HIDDEN_CLOSE_MS = 60_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 5 * 60_000;
/** A check is shown as "updating" only once it has run this long: a quick 304 never flickers. */
const CHECKING_SHOWN_AFTER_MS = 600;
/** Once shown, the notice stays at least this long, so it can be read. */
const UPDATING_MIN_SHOWN_MS = 800;

interface Channel {
  gameMode: GameMode;
  consumers: number;
  socket: WebSocket | null;
  latest: PriceUpdate | null;
  listeners: Set<() => void>;
  backoff: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  checkingTimer: ReturnType<typeof setTimeout> | null;
  /** The refresher's check has run long enough to show. */
  checkingShown: boolean;
}

const channels = new Map<GameMode, Channel>();
const updatingListeners = new Set<() => void>();
let activeUpdates = 0;
let updating = false;
let shownAt = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
/** The tab has been hidden long enough that its sockets were closed. */
let paused = false;
let visibilityWatched = false;

function channelOf(gameMode: GameMode) {
  let channel = channels.get(gameMode);
  if (!channel) {
    channel = {
      gameMode,
      consumers: 0,
      socket: null,
      latest: null,
      listeners: new Set(),
      backoff: RETRY_BASE_MS,
      retryTimer: null,
      pingTimer: null,
      checkingTimer: null,
      checkingShown: false,
    };
    channels.set(gameMode, channel);
  }
  return channel;
}

function notify(channel: Channel) {
  for (const listener of channel.listeners) listener();
}

/** Recomputes the header's notice: an update in flight, or a check that has run a while. */
function refreshUpdating() {
  const wanted = activeUpdates > 0 || [...channels.values()].some((channel) => channel.consumers > 0 && channel.checkingShown);
  if (wanted === updating && !(wanted && hideTimer)) return;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (wanted) {
    if (!updating) shownAt = Date.now();
    setUpdating(true);
    return;
  }
  const remaining = shownAt + UPDATING_MIN_SHOWN_MS - Date.now();
  if (remaining > 0) hideTimer = setTimeout(() => {
    hideTimer = null;
    refreshUpdating();
  }, remaining);
  else setUpdating(false);
}

function setUpdating(next: boolean) {
  if (next === updating) return;
  updating = next;
  for (const listener of updatingListeners) listener();
}

function receive(channel: Channel, update: PriceUpdate) {
  channel.latest = update;
  if (update.checking && !channel.checkingTimer && !channel.checkingShown) {
    channel.checkingTimer = setTimeout(() => {
      channel.checkingTimer = null;
      if (channel.latest?.checking) {
        channel.checkingShown = true;
        refreshUpdating();
      }
    }, CHECKING_SHOWN_AFTER_MS);
  } else if (!update.checking) {
    if (channel.checkingTimer) clearTimeout(channel.checkingTimer);
    channel.checkingTimer = null;
    channel.checkingShown = false;
    refreshUpdating();
  }
  notify(channel);
}

function connect(channel: Channel) {
  if (channel.socket || channel.retryTimer || channel.consumers === 0 || paused) return;
  if (typeof WebSocket === "undefined" || typeof location === "undefined") return;
  watchVisibility();
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  let socket: WebSocket;
  try {
    socket = new WebSocket(`${scheme}//${location.host}${PRICE_SOCKET_PATH}?mode=${channel.gameMode}`);
  } catch {
    retryLater(channel);
    return;
  }
  channel.socket = socket;
  socket.onopen = () => {
    channel.backoff = RETRY_BASE_MS;
    channel.pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send("ping");
    }, PING_INTERVAL_MS);
  };
  socket.onmessage = (event) => {
    if (event.data === "pong") return;
    const update = parsePriceUpdate(event.data);
    if (update) receive(channel, update);
  };
  socket.onclose = () => {
    if (channel.socket !== socket) return;
    drop(channel);
    if (channel.consumers > 0 && !paused) retryLater(channel);
  };
}

function retryLater(channel: Channel) {
  const delay = channel.backoff * (0.8 + Math.random() * 0.4);
  channel.backoff = Math.min(RETRY_MAX_MS, channel.backoff * 2);
  channel.retryTimer = setTimeout(() => {
    channel.retryTimer = null;
    connect(channel);
  }, delay);
}

/** Forgets the channel's socket (closing it if open) and anything shown for it. */
function drop(channel: Channel) {
  if (channel.pingTimer) clearInterval(channel.pingTimer);
  if (channel.checkingTimer) clearTimeout(channel.checkingTimer);
  channel.pingTimer = channel.checkingTimer = null;
  channel.checkingShown = false;
  const socket = channel.socket;
  channel.socket = null;
  if (socket && socket.readyState <= 1) {
    try {
      socket.close(1000, "Done");
    } catch {
      // Already closing.
    }
  }
  refreshUpdating();
}

function watchVisibility() {
  if (visibilityWatched || typeof document === "undefined") return;
  visibilityWatched = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenTimer ??= setTimeout(() => {
        hiddenTimer = null;
        paused = true;
        for (const channel of channels.values()) {
          if (channel.retryTimer) clearTimeout(channel.retryTimer);
          channel.retryTimer = null;
          drop(channel);
        }
      }, HIDDEN_CLOSE_MS);
      return;
    }
    if (hiddenTimer) clearTimeout(hiddenTimer);
    hiddenTimer = null;
    if (!paused) return;
    paused = false;
    // Back: reconnect; the refresher's first message brings the current version.
    for (const channel of channels.values()) connect(channel);
  });
}

/** Follows the mode's live prices; the socket is open while anything follows them. */
export function subscribeLivePrices(gameMode: GameMode, listener: () => void) {
  const channel = channelOf(gameMode);
  channel.listeners.add(listener);
  channel.consumers += 1;
  connect(channel);
  return () => {
    channel.listeners.delete(listener);
    channel.consumers -= 1;
    if (channel.consumers > 0) return;
    if (channel.retryTimer) clearTimeout(channel.retryTimer);
    channel.retryTimer = null;
    drop(channel);
  };
}

/** The current price version for the mode, as the refresher last said; null when not known. */
export function livePricesVersion(gameMode: GameMode): number | null {
  return channels.get(gameMode)?.latest?.version ?? null;
}

/**
 * The price version a priced page's loader should ask for (`p`): the current one, once a socket has
 * said, for the mode in the game mode cookie (which the server renders for) unless one is given.
 * Undefined on the server and before the socket has said.
 */
export function wantedPricesVersion(gameMode?: GameMode): number | undefined {
  if (typeof document === "undefined") return undefined;
  const mode = gameMode ?? cookieGameMode();
  return livePricesVersion(mode) ?? undefined;
}

function cookieGameMode(): GameMode {
  const match = new RegExp(`(?:^|;\\s*)${GAME_MODE_COOKIE}=([^;]*)`).exec(document.cookie);
  return match && isGameMode(match[1]) ? match[1] : "regular";
}

/** Counts an update of a page's prices towards the header's notice while it runs. */
function trackUpdate(work: Promise<unknown>) {
  activeUpdates += 1;
  refreshUpdating();
  void work
    .catch(() => undefined)
    .finally(() => {
      activeUpdates -= 1;
      refreshUpdating();
    });
}

/** Whether the prices on the page are being updated: for the header's notice. */
export function isUpdatingPrices() {
  return updating;
}

export function subscribeUpdatingPrices(listener: () => void) {
  updatingListeners.add(listener);
  return () => {
    updatingListeners.delete(listener);
  };
}

const NO_SUBSCRIPTION = () => () => undefined;

/**
 * Keeps prices a page shows in step with the refresher: while mounted, follows the mode's live
 * prices, and when the current version is newer than `shownVersion` (the version the page's data came
 * from), calls `update` with it once. Does nothing while `shownVersion` is unknown (prices that
 * didn't come from the feed) or on the server.
 */
export function useLivePrices(gameMode: GameMode, shownVersion: number | null | undefined, update: (version: number) => Promise<unknown>, enabled = true) {
  const subscribe = useCallback((listener: () => void) => subscribeLivePrices(gameMode, listener), [gameMode]);
  const latest = useSyncExternalStore(
    enabled ? subscribe : NO_SUBSCRIPTION,
    () => (enabled ? livePricesVersion(gameMode) : null),
    () => null
  );
  const asked = useRef(0);
  const run = useEffectEvent((version: number) => trackUpdate(update(version)));
  useEffect(() => {
    if (latest === null || shownVersion === null || shownVersion === undefined) return;
    if (latest <= shownVersion || latest <= asked.current) return;
    asked.current = latest;
    run(latest);
  }, [latest, shownVersion]);
}

/** useLivePrices for a page whose prices come from its route loader: the loader runs again for the new version. */
export function useLiveRoutePrices(routeId: string, shownVersion: number | null | undefined, gameMode?: GameMode) {
  const router = useRouter();
  const { gameMode: current, hydrated } = useGameMode();
  const mode = gameMode ?? current;
  useLivePrices(mode, shownVersion, () => router.invalidate({ filter: (match) => match.routeId === routeId }), hydrated);
}
