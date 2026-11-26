import { DurableObject } from "cloudflare:workers";
import { isGameMode, type GameMode } from "@/components/game-mode/mode";
import { PRICE_FEED_FORMAT, type PriceFeedWire } from "@/app/lib/api/price-feed";
import { devTimeScale, priceFeedStoreKey, type DatasetAnswer, type PricesAnswer } from "@/app/lib/api/refresher";
import {
  initialSchedule,
  isCheckDue,
  observeClock,
  recordCheck,
  recordFailure,
  scaledScheduleConfig,
  type ScheduleState,
} from "@/app/lib/api/refresh-schedule";
import { fetchPriceRows, fetchSharedDataset, isSharedResource, SHARED_REFRESH_MS, type SharedResource } from "@/app/lib/api/tarkov-server";
import type { PriceUpdate } from "@/app/lib/prices/live-protocol";

/** Open price sockets one refresher takes; past it, pages keep the prices they have. */
export const PRICE_SOCKET_LIMIT = 10_000;
/** 1 in production; faster clocks in local simulations (devTimeScale). */
const SCALE = devTimeScale();
const SCHEDULE = scaledScheduleConfig(SCALE);
/** A shared dataset is checked with tarkov.dev at most this often. */
const DATASET_REFRESH_MS = SHARED_REFRESH_MS;
/** After a failed dataset check, it isn't checked again for this long, doubling. */
const DATASET_RETRY_BASE_MS = 10_000 / SCALE;
const DATASET_RETRY_MAX_MS = (10 * 60_000) / SCALE;
/** A dataset body an instance found missing is written again at most this often. */
const REWRITE_INTERVAL_MS = (5 * 60_000) / SCALE;

/**
 * Parsing the items file takes a large share of an isolate's memory, and both modes' refreshers may
 * share an isolate, so their price checks take turns: one items file in memory at a time.
 */
let itemsTurn: Promise<unknown> = Promise.resolve();
function oneItemsFileAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = itemsTurn.then(work, work);
  itemsTurn = run.catch(() => undefined);
  return run;
}

interface PricesRecord {
  /** Rises with each new items file; null until the first check. */
  version: number | null;
  etag: string | null;
  lastModified: string | null;
  confirmedAt: number;
  /** The last check failed. */
  stale: boolean;
  schedule: ScheduleState;
}

interface DatasetRecord {
  version: string | null;
  etag: string | null;
  lastModified: string | null;
  checkedAt: number;
  stale: boolean;
  failures: number;
  retryAt: number;
  rewrittenAt: number;
}

const EMPTY_DATASET: DatasetRecord = {
  version: null,
  etag: null,
  lastModified: null,
  checkedAt: 0,
  stale: false,
  failures: 0,
  retryAt: 0,
  rewrittenAt: 0,
};

/**
 * The refresher, one per game mode (named "regular" or "pve"): the only caller of tarkov.dev for
 * prices and the shared datasets, and the live price push.
 *
 * - Prices: tarkov.dev rebuilds its items file about every 10 minutes. The refresher learns when
 *   (refresh-schedule.ts) and checks only once a change is due, and only when asked: by an instance
 *   whose copy is due, or by its alarm while pages are open. Every caller shares the one check in
 *   flight. A new file becomes a new feed version, written to KV for cold instances and handed to
 *   the instances that ask; an unchanged one writes nothing.
 * - Shared datasets (maps, tasks, traders, …): checked at most hourly, when asked for, with the
 *   shared copy's validators. A new copy is written to KV under its version; a 304 writes nothing.
 * - The push: pages showing prices hold a hibernatable WebSocket here and are told when a check
 *   starts and what the current version is, so they swap in new prices without polling.
 *
 * State is a few small records in SQLite; the feed body is kept in memory and in KV.
 */
export class DataRefreshDO extends DurableObject<Env> {
  private gameMode: GameMode | null = null;
  private priceState: PricesRecord = { version: null, etag: null, lastModified: null, confirmedAt: 0, stale: false, schedule: initialSchedule(SCHEDULE) };
  private readonly datasets = new Map<string, DatasetRecord>();
  /** The current feed body, once read or built. */
  private body: string | null = null;
  private pricesCheck: Promise<void> | null = null;
  private readonly datasetChecks = new Map<string, Promise<void>>();
  /** Requests since the last check was logged: how much demand each check served. */
  private calls = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS refresher_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    for (const row of sql.exec<{ key: string; value: string }>("SELECT key, value FROM refresher_state").toArray()) {
      const value = JSON.parse(row.value) as unknown;
      if (row.key === "mode" && isGameMode(value)) this.gameMode = value;
      else if (row.key === "prices") this.priceState = { ...this.priceState, ...(value as PricesRecord) };
      else if (row.key.startsWith("dataset:")) this.datasets.set(row.key.slice("dataset:".length), { ...EMPTY_DATASET, ...(value as DatasetRecord) });
    }
    // Heartbeats are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** The current prices, after a check if one is due; with the feed body when the caller's version differs. */
  async prices(gameMode: GameMode, have: number | null): Promise<PricesAnswer> {
    this.bind(gameMode);
    this.calls += 1;
    if (isCheckDue(this.priceState.schedule, Date.now())) await this.checkPrices();
    else if (this.pricesCheck) await this.pricesCheck;
    let body = this.priceState.version !== null && have !== this.priceState.version ? await this.priceBody() : null;
    if (this.priceState.version !== null && have !== this.priceState.version && body === null) {
      // The body is gone (KV lost it while this object was asleep): fetch the file afresh, once.
      await this.checkPrices(true);
      body = await this.priceBody();
    }
    const { version, confirmedAt, stale, schedule } = this.priceState;
    return { version, confirmedAt, stale, nextCheckAt: schedule.nextCheckAt, ...(body !== null && have !== version ? { body } : {}) };
  }

  /** A shared dataset's current version, after a check if its copy is over an hour old. */
  async dataset(gameMode: GameMode, resource: string, have: string | null, missing = false): Promise<DatasetAnswer> {
    this.bind(gameMode);
    if (!isSharedResource(resource)) throw new Error(`${resource} isn't a shared dataset.`);
    this.calls += 1;
    const record = this.datasets.get(resource) ?? EMPTY_DATASET;
    const now = Date.now();
    const due = now - record.checkedAt >= DATASET_REFRESH_MS && now >= record.retryAt;
    const rewrite = missing && record.version !== null && now - record.rewrittenAt >= REWRITE_INTERVAL_MS && now >= record.retryAt;
    if (due || rewrite) await this.checkDataset(resource, rewrite);
    else await this.datasetChecks.get(resource);
    const current = this.datasets.get(resource) ?? EMPTY_DATASET;
    return {
      version: current.version,
      etag: current.etag,
      lastModified: current.lastModified,
      checkedAt: current.checkedAt,
      stale: current.stale,
    };
  }

  /** A page's price socket (GET /api/prices/live?mode=…, upgraded by the Worker). */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket.", { status: 426 });
    const gameMode = new URL(request.url).searchParams.get("mode");
    if (!isGameMode(gameMode)) return new Response("Unknown game mode.", { status: 400 });
    this.bind(gameMode);
    this.calls += 1;
    if (this.ctx.getWebSockets().length >= PRICE_SOCKET_LIMIT) return new Response("Busy", { status: 429, headers: { "Retry-After": "60" } });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.send(server, this.update(this.pricesCheck !== null));
    // An open page is demand: check now if a check is due (an edge-cached page never asked), and
    // keep the alarm set for the next one while pages stay open.
    if (isCheckDue(this.priceState.schedule, Date.now())) this.background(this.checkPrices());
    else await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** While pages are open, checks when the next change is due, so they get it without a request. */
  async alarm() {
    if (this.ctx.getWebSockets().length === 0 || !this.gameMode) return;
    if (isCheckDue(this.priceState.schedule, Date.now())) await this.checkPrices();
    else await this.scheduleAlarm();
  }

  /** Pages send nothing but heartbeats, which the runtime answers. */
  async webSocketMessage() {}

  async webSocketClose(socket: WebSocket, code: number) {
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, "Closed");
    } catch {
      // Already closed.
    }
  }

  async webSocketError(socket: WebSocket) {
    try {
      socket.close(1011, "Error");
    } catch {
      // Already closed.
    }
  }

  private bind(gameMode: GameMode) {
    if (this.gameMode === gameMode) return;
    if (this.gameMode !== null) throw new Error(`This refresher serves ${this.gameMode}, not ${gameMode}.`);
    this.gameMode = gameMode;
    this.save("mode", gameMode);
  }

  /** Checks tarkov.dev's items file, sharing one check among callers. `fresh`: without validators. */
  private checkPrices(fresh = false): Promise<void> {
    if (this.pricesCheck) return this.pricesCheck;
    const gameMode = this.gameMode!;
    const check = (async () => {
      this.broadcast(this.update(true));
      const record = this.priceState;
      let started = Date.now();
      const validators = !fresh && record.version !== null ? { etag: record.etag ?? undefined, lastModified: record.lastModified ?? undefined } : undefined;
      let outcome = "failed";
      let wroteKv = false;
      try {
        const result = await oneItemsFileAtATime(() => {
          started = Date.now();
          return fetchPriceRows(gameMode, validators);
        });
        const now = Date.now();
        let schedule = observeClock(record.schedule, result.date, (started + now) / 2, SCHEDULE);
        const heldModified = httpTime(record.lastModified);
        const fetchedModified = result.notModified ? null : httpTime(result.lastModified);
        if (result.notModified || (!fresh && heldModified !== null && fetchedModified !== null && fetchedModified < heldModified)) {
          // Unchanged (or an older file than ours, from a lagging cache upstream): only the confirmation moves.
          schedule = recordCheck(schedule, { now, lastModifiedMs: heldModified }, SCHEDULE);
          this.priceState = { ...record, confirmedAt: now, stale: false, schedule };
          outcome = result.notModified ? "unchanged" : "older";
        } else {
          schedule = recordCheck(schedule, { now, lastModifiedMs: fetchedModified }, SCHEDULE);
          outcome = "changed";
          const version = Math.max((record.version ?? 0) + 1, now);
          const wire: PriceFeedWire = {
            format: PRICE_FEED_FORMAT,
            gameMode,
            version,
            nextCheckAt: schedule.nextCheckAt,
            fetchedAt: now,
            source: "tarkov.dev",
            stale: false,
            etag: result.etag,
            lastModified: result.lastModified,
            ...result.rows,
          };
          const body = JSON.stringify({ data: wire });
          this.body = body;
          this.priceState = { version, etag: result.etag, lastModified: result.lastModified, confirmedAt: now, stale: false, schedule };
          // For cold instances; the instances that ask get the body from here, so a failed write only costs them a request.
          wroteKv = await this.env.TARKOV_DATA.put(priceFeedStoreKey(gameMode, PRICE_FEED_FORMAT), body).then(
            () => true,
            (error: unknown) => {
              console.warn(`The ${gameMode} price feed couldn't be written to KV.`, error instanceof Error ? error.message : error);
              return false;
            }
          );
        }
      } catch (error) {
        this.priceState = { ...record, stale: true, schedule: recordFailure(record.schedule, Date.now(), SCHEDULE) };
        console.warn(`The ${gameMode} price check failed.`, error instanceof Error ? error.message : error);
      }
      this.save("prices", this.priceState);
      const { schedule } = this.priceState;
      this.logCheck("prices", outcome, wroteKv, {
        nextCheckAt: new Date(schedule.nextCheckAt).toISOString(),
        periodSeconds: Math.round(schedule.periodMs / 1000),
        retries: schedule.retries,
        // How long after tarkov.dev published it the newest change was seen.
        ...(outcome === "changed" && schedule.changes.length ? { lagSeconds: Math.round((Date.now() - schedule.changes[schedule.changes.length - 1]) / 100) / 10 } : {}),
      });
      this.broadcast(this.update(false));
      await this.scheduleAlarm();
    })().finally(() => {
      this.pricesCheck = null;
    });
    this.pricesCheck = check;
    return check;
  }

  /** The current feed body: in memory, else from KV if it is the current version. Null when there is none. */
  private async priceBody(): Promise<string | null> {
    const version = this.priceState.version;
    if (version === null) return null;
    if (this.body !== null && bodyVersion(this.body) === version) return this.body;
    const stored = await this.env.TARKOV_DATA.get(priceFeedStoreKey(this.gameMode!, PRICE_FEED_FORMAT), { type: "text" }).catch(() => null);
    if (stored === null || bodyVersion(stored) !== version) return null;
    this.body = stored;
    return stored;
  }

  private checkDataset(resource: SharedResource, rewrite: boolean): Promise<void> {
    const inFlight = this.datasetChecks.get(resource);
    if (inFlight) return inFlight;
    const gameMode = this.gameMode!;
    const check = (async () => {
      const record = this.datasets.get(resource) ?? EMPTY_DATASET;
      const validators = !rewrite && record.version !== null ? { etag: record.etag ?? undefined, lastModified: record.lastModified ?? undefined } : undefined;
      let next: DatasetRecord;
      let outcome = "failed";
      try {
        const result = await fetchSharedDataset(gameMode, resource, validators, {
          put: (key, value, options) => this.env.TARKOV_DATA.put(key, value, options),
        });
        const now = Date.now();
        outcome = result.notModified ? "unchanged" : "changed";
        next = result.notModified
          ? { ...record, checkedAt: now, stale: false, failures: 0, retryAt: 0 }
          : {
              version: result.version,
              etag: result.etag,
              lastModified: result.lastModified,
              checkedAt: now,
              stale: false,
              failures: 0,
              retryAt: 0,
              rewrittenAt: rewrite ? now : record.rewrittenAt,
            };
      } catch (error) {
        const failures = record.failures + 1;
        const backoff = Math.min(DATASET_RETRY_MAX_MS, DATASET_RETRY_BASE_MS * 2 ** Math.min(failures - 1, 10));
        next = { ...record, stale: record.version !== null, failures, retryAt: Date.now() + backoff * (0.8 + Math.random() * 0.4) };
        console.warn(`The ${gameMode} ${resource} check failed.`, error instanceof Error ? error.message : error);
      }
      this.datasets.set(resource, next);
      this.save(`dataset:${resource}`, next);
      this.logCheck(resource, outcome, outcome === "changed", rewrite ? { rewrite: true } : {});
    })().finally(() => {
      this.datasetChecks.delete(resource);
    });
    this.datasetChecks.set(resource, check);
    return check;
  }

  /** One line per check, as fields Workers Logs can filter on: what was checked, what came of it, and the demand it served. */
  private logCheck(dataset: string, outcome: string, wroteKv: boolean, extra: Record<string, unknown>) {
    console.info(JSON.stringify({ event: "refresher_check", gameMode: this.gameMode, dataset, outcome, wroteKv, calls: this.calls, sockets: this.ctx.getWebSockets().length, ...extra }));
    this.calls = 0;
  }

  private async scheduleAlarm() {
    if (this.ctx.getWebSockets().length === 0) return;
    const now = Date.now();
    const at = Math.max(this.priceState.schedule.nextCheckAt, now + 1_000);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at || current < now) await this.ctx.storage.setAlarm(at);
  }

  private update(checking: boolean): PriceUpdate {
    const { version, lastModified, confirmedAt, stale } = this.priceState;
    const publishedAt = httpTime(lastModified);
    return {
      type: "prices",
      version,
      publishedAt: publishedAt === null ? null : new Date(publishedAt).toISOString(),
      confirmedAt: confirmedAt ? new Date(confirmedAt).toISOString() : null,
      checking,
      stale,
    };
  }

  private broadcast(message: PriceUpdate) {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) this.sendText(socket, text);
  }

  private send(socket: WebSocket, message: PriceUpdate) {
    this.sendText(socket, JSON.stringify(message));
  }

  private sendText(socket: WebSocket, text: string) {
    try {
      socket.send(text);
    } catch {
      // Closing; webSocketClose cleans up.
    }
  }

  private background(work: Promise<unknown>) {
    const guarded = work.catch(() => undefined);
    (this.ctx as { waitUntil?: (promise: Promise<unknown>) => void }).waitUntil?.(guarded);
  }

  private save(key: string, value: unknown) {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO refresher_state (key, value) VALUES (?, ?)", key, JSON.stringify(value));
  }
}

/** A feed body's version, read from its start without parsing the whole body. */
function bodyVersion(body: string): number | null {
  const match = /"version":(\d{1,16})[,}]/.exec(body.slice(0, 400));
  return match ? Number(match[1]) : null;
}

function httpTime(value: string | null | undefined): number | null {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
}
