import { cache } from "react";
import { customDecodeURI } from "@/app/lib/URIEncoding";
import { isItemSlug } from "@/app/lib/item-links";
import { executeTarkovOperation, getItemPageIndex, releaseRenderSlot, waitForRenderSlot } from "@/app/lib/api/tarkov-server";
import type { ItemIndexing } from "@/app/lib/seo/item-index";
import { RENDER_TIMEOUT_MS } from "@/app/lib/api/server-render";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import type { GameMode } from "@/components/game-mode/mode";
import type { ComposedItem } from "@/app/lib/cache/types";

/**
 * Thrown when the item couldn't be loaded in time, so the render fails: a background render keeps
 * the cached page, and a first render answers with a server error (crawlers retry later) instead
 * of caching an empty page.
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
  const signal = AbortSignal.timeout(RENDER_TIMEOUT_MS);
  try {
    await waitForRenderSlot(signal);
  } catch {
    console.warn("Item page rendered without its item: the server is busy.");
    return undefined;
  }
  try {
    return (await executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, { gameMode, ...reference }, { signal })) as ComposedItem | null;
  } catch (error) {
    console.warn("Item page rendered without its item:", error instanceof Error ? error.message : error);
    return undefined;
  } finally {
    releaseRenderSlot();
  }
});

export async function resolveItemRoute(gameMode: GameMode, segment: string) {
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
  const timeout = RENDER_TIMEOUT_MS;
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
