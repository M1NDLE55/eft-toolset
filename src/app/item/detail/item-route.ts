import { cache } from "react";
import { customDecodeURI } from "@/app/lib/URIEncoding";
import { isItemSlug, itemReference } from "@/app/lib/item-links";
import { executeTarkovOperation, getItemPageIndex, releaseRenderSlot, runTarkovRead, waitForRenderSlot } from "@/app/lib/api/tarkov-server";
import type { ItemIndexing } from "@/app/lib/seo/item-index";
import { livePriceReadOptions, RENDER_TIMEOUT_MS } from "@/app/lib/api/server-render";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import type { GameMode } from "@/components/game-mode/mode";
import type { ComposedItem } from "@/app/lib/cache/types";

/**
 * How long an item render waits for a dataset that is due a refresh before using the copy it holds
 * (no older than RESOURCE_MAX_STALE_MS). Without a limit, a cold instance whose deployment snapshot
 * has aged past a dataset's revalidation (barters, traders and the name files after four hours)
 * waits on tarkov.dev for each, four requests at a time, and a slow tarkov.dev runs the render past
 * RENDER_TIMEOUT_MS. With it, the page renders from the copies, is cached briefly, and the browser
 * loads the item afresh once the page is up (see loadItemPage).
 */
export const ITEM_RENDER_STALE_WAIT_MS = 2_500;
/** A step slower than this is logged with its time, so Workers Logs show where a slow render went. */
const SLOW_STEP_MS = 3_000;

type ItemStep = "render slot" | "item" | "item index";

/**
 * Notes why an item page rendered without what it needed, as fields Workers Logs can filter on:
 * the page, the step (the render slot, the item or the index), how long it took, and whether it ran
 * out of time.
 */
function warnItemPage(segment: string, step: ItemStep, ms: number, error?: unknown) {
  const fields = { page: `/item/${segment}`.slice(0, 240), step, ms: Math.round(ms) };
  if (error === undefined) console.warn("Item page timed out", fields);
  else console.warn("Item page data failed", { ...fields, error: error instanceof Error ? error.message : String(error) });
}

export interface ItemLoad {
  /** null when there's no such item, undefined when it couldn't be loaded in time. */
  item: ComposedItem | null | undefined;
  /**
   * When the item was built from a copy whose refresh failed or didn't finish in time: the time of
   * the oldest copy it used. Undefined for a current read.
   */
  staleSince?: number;
}

/** The item for the page, with how current it is. */
export const loadItem = cache(async (segment: string, gameMode: GameMode): Promise<ItemLoad> => {
  const reference = itemReference(segment);
  if (!reference) return { item: null };
  const started = performance.now();
  const signal = AbortSignal.timeout(RENDER_TIMEOUT_MS);
  try {
    await waitForRenderSlot(signal);
  } catch {
    warnItemPage(segment, "render slot", performance.now() - started);
    return { item: undefined };
  }
  const slotMs = performance.now() - started;
  let stale = false;
  let dataAgeMs = 0;
  try {
    const item = (await executeTarkovOperation(
      TARKOV_OPERATIONS.itemDetail,
      { gameMode, ...reference },
      {
        signal,
        staleWaitMs: ITEM_RENDER_STALE_WAIT_MS,
        ...livePriceReadOptions(),
        onStale: () => void (stale = true),
        onDataAge: (ageMs) => void (dataAgeMs = ageMs),
      }
    )) as ComposedItem | null;
    const itemMs = performance.now() - started - slotMs;
    if (stale || slotMs + itemMs > SLOW_STEP_MS) {
      console.warn("Item page slow or stale", {
        page: `/item/${segment}`.slice(0, 240),
        slotMs: Math.round(slotMs),
        itemMs: Math.round(itemMs),
        stale,
        dataAgeMinutes: Math.round(dataAgeMs / 60_000),
      });
    }
    return stale ? { item, staleSince: Date.now() - dataAgeMs } : { item };
  } catch (error) {
    warnItemPage(segment, "item", performance.now() - started, signal.aborted ? undefined : error);
    return { item: undefined };
  } finally {
    releaseRenderSlot();
  }
});

export async function resolveItemRoute(gameMode: GameMode, segment: string) {
  const { item, staleSince } = await loadItem(segment, gameMode);
  const slug = isItemSlug(segment) ? segment : null;
  const name = item?.name ?? (slug ? null : customDecodeURI(segment) || null);
  const canonical = item?.normalizedName && isItemSlug(item.normalizedName) ? item.normalizedName : null;
  const reference = slug ? { slug } : name ? { name } : null;
  return { gameMode, item, name, canonical, reference, renderedAt: Date.now(), staleSince };
}

/**
 * The page's indexing from PVP's item index, as the sitemap decides it, whatever the visitor's mode.
 * It reads data the item page has (or the site keeps) in memory, so it takes no operation slot: a
 * busy server mustn't turn a near-duplicate into its own canonical. undefined only when it can't be
 * read in time.
 */
export async function loadItemIndexing(slug: string): Promise<ItemIndexing | undefined> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const index = await Promise.race([
      // Waits for a due refresh no longer than the item did (the index's names change only with patches).
      runTarkovRead(() => getItemPageIndex("regular"), { staleWaitMs: ITEM_RENDER_STALE_WAIT_MS }),
      new Promise<"timed out">((resolve) => {
        timer = setTimeout(() => resolve("timed out"), RENDER_TIMEOUT_MS);
      }),
    ]);
    if (index === "timed out") {
      warnItemPage(slug, "item index", performance.now() - started);
      return undefined;
    }
    return index.pages.get(slug)?.indexing;
  } catch (error) {
    warnItemPage(slug, "item index", performance.now() - started, error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
