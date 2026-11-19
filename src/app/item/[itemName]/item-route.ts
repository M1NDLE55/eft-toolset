import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { customDecodeURI } from "@/app/lib/URIEncoding";
import { isItemSlug } from "@/app/lib/item-links";
import { executeTarkovOperation, getItemPageIndex, releaseOperationSlot, tryAcquireOperationSlot } from "@/app/lib/api/tarkov-server";
import type { ItemIndexing } from "@/app/lib/seo/item-index";
import { renderTimeoutMs, requestGameMode } from "@/app/lib/api/server-render";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import type { GameMode } from "@/components/game-mode/mode";
import type { ComposedItem } from "@/app/lib/cache/types";

export { isCrawlerRequest, requestGameMode } from "@/app/lib/api/server-render";

/**
 * Thrown for a crawler when the item couldn't be loaded in time, so the page answers with a
 * server error and the crawler retries later, instead of indexing an empty page or dropping it.
 */
export class ItemTemporarilyUnavailableError extends Error {
  constructor() {
    super("Item data is temporarily unavailable.");
    this.name = "ItemTemporarilyUnavailableError";
  }
}

export const loadItem = cache(async (segment: string, gameMode: GameMode): Promise<ComposedItem | null | undefined> => {
  const reference = isItemSlug(segment) ? { slug: segment } : { name: customDecodeURI(segment) };
  if ("name" in reference && !reference.name) return null;
  const timeout = await renderTimeoutMs();
  if (!tryAcquireOperationSlot()) {
    console.warn("Item page rendered without its item: the server is busy.");
    return undefined;
  }
  try {
    return (await executeTarkovOperation(
      TARKOV_OPERATIONS.itemDetail,
      { gameMode, ...reference },
      { signal: AbortSignal.timeout(timeout) }
    )) as ComposedItem | null;
  } catch (error) {
    unstable_rethrow(error);
    console.warn("Item page rendered without its item:", error instanceof Error ? error.message : error);
    return undefined;
  } finally {
    releaseOperationSlot();
  }
});

export async function resolveItemRoute(segment: string) {
  const gameMode = await requestGameMode();
  const item = await loadItem(segment, gameMode);
  const slug = isItemSlug(segment) ? segment : null;
  const name = item?.name ?? (slug ? null : customDecodeURI(segment) || null);
  const canonical = item?.normalizedName && isItemSlug(item.normalizedName) ? item.normalizedName : null;
  const reference = slug ? { slug } : name ? { name } : null;
  return { gameMode, item, name, canonical, reference, renderedAt: Date.now() };
}

/**
 * The page's indexing from PVP's item index, as the sitemap decides it, whatever the visitor's mode.
 * It reads data the item page has (or the site keeps) in memory, so it takes no operation slot: a
 * busy server mustn't turn a near-duplicate into its own canonical. undefined only when it can't be
 * read in time.
 */
export async function loadItemIndexing(slug: string): Promise<ItemIndexing | undefined> {
  const timeout = await renderTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const index = await Promise.race([
      getItemPageIndex("regular"),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeout);
      }),
    ]);
    return index?.pages.get(slug)?.indexing;
  } catch (error) {
    console.warn("Item page rendered without its index:", error instanceof Error ? error.message : error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
