import { AsyncLocalStorage } from "node:async_hooks";
import { RenderDataUnavailableError } from "@/app/lib/render-errors";
import { cacheAtEdge } from "@/app/lib/server/edge-response";
import { EDGE_TTL } from "@/app/lib/server/edge-cache";
import type { GameMode } from "@/components/game-mode/mode";
import type { LivePricesInput } from "@/app/lib/prices/live-input";
import { runTarkovRead, waitForRenderSlot, releaseRenderSlot, type TarkovReadOptions } from "./tarkov-server";

/**
 * Content pages are rendered once and cached for everyone, crawlers included, mostly in the
 * background when a cached copy goes stale. So a render waits for its data rather than giving up
 * early, and a page whose main data didn't arrive throws (see `requireForRender`): a failed
 * background render keeps the previous copy, and a first render answers with a server error that
 * isn't cached, instead of caching an empty page.
 */
export const RENDER_TIMEOUT_MS = 15_000;

/**
 * Runs a tarkov-server read while rendering a page. Returns undefined when the read fails or takes
 * too long, for data the page can go without. `staleWaitMs` limits how long it waits for a due
 * refresh before using the copy it holds (see TarkovReadOptions); by default it waits.
 */
export async function readForRender<T>(label: string, work: () => Promise<T>, staleWaitMs?: number): Promise<T | undefined> {
  const signal = AbortSignal.timeout(RENDER_TIMEOUT_MS);
  try {
    await waitForRenderSlot(signal);
  } catch {
    console.warn(`${label} rendered without its data: the server is busy.`);
    return undefined;
  }
  try {
    return await runTarkovRead(work, { signal, staleWaitMs, ...livePriceReadOptions() });
  } catch (error) {
    console.warn(`${label} rendered without its data:`, error instanceof Error ? error.message : error);
    return undefined;
  } finally {
    releaseRenderSlot();
  }
}

/** As `readForRender`, for data the page can't go without: throws instead of returning undefined. */
export async function requireForRender<T>(label: string, work: () => Promise<T>): Promise<T> {
  const result = await readForRender(label, work);
  if (result === undefined) throw new RenderDataUnavailableError(label);
  return result;
}

/** What a page that shows prices carries for the live price push (see live-prices.ts). */
export interface LivePricesData {
  /** The price feed version the page was rendered from; null when its prices came from elsewhere. */
  pricesVersion: number | null;
}

interface LivePricesRender {
  gameMode: GameMode;
  minPricesVersion?: number;
  versions: (number | null)[];
}

const livePricesRender = new AsyncLocalStorage<LivePricesRender>();

/** The read options that make a read inside renderLivePrices honour and report the price version. */
export function livePriceReadOptions(): Pick<TarkovReadOptions, "minPricesVersion" | "onPriceSource"> {
  const render = livePricesRender.getStore();
  if (!render) return {};
  return {
    minPricesVersion: render.minPricesVersion === undefined ? undefined : { gameMode: render.gameMode, version: render.minPricesVersion },
    onPriceSource: (info) => {
      if (info.gameMode === render.gameMode) render.versions.push(info.version);
    },
  };
}

/**
 * Renders a page that shows prices: its reads take at least the version the page asked for (`p`),
 * and the result carries the version it was rendered from, so the page knows when the refresher's
 * push brings newer prices. A render that couldn't get the version asked for is cached only briefly.
 */
export async function renderLivePrices<T extends object>(gameMode: GameMode, input: LivePricesInput, work: () => Promise<T>): Promise<T & LivePricesData> {
  const render: LivePricesRender = { gameMode, minPricesVersion: input.p, versions: [] };
  const result = await livePricesRender.run(render, work);
  const known = render.versions.filter((version): version is number => version !== null);
  const pricesVersion = known.length > 0 && known.length === render.versions.length ? Math.min(...known) : null;
  if (input.p !== undefined && (pricesVersion === null || pricesVersion < input.p)) cacheAtEdge(EDGE_TTL.behind);
  return { ...result, pricesVersion };
}
