import { cache } from "react";
import { customDecodeURI } from "@/app/lib/URIEncoding";
import { isItemSlug, itemReference } from "@/app/lib/item-links";
import { executeTarkovOperation, getItemPageIndex, releaseRenderSlot, waitForRenderSlot } from "@/app/lib/api/tarkov-server";
import type { ItemIndexing } from "@/app/lib/seo/item-index";
import { RENDER_TIMEOUT_MS } from "@/app/lib/api/server-render";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import type { GameMode } from "@/components/game-mode/mode";
import type { ComposedItem } from "@/app/lib/cache/types";

/**
 * Notes why an item page rendered without what it needed, as fields Workers Logs can filter on:
 * the page, the step (the render slot, the item or the index) and whether it ran out of time.
 */
function warnItemPage(segment: string, step: "render slot" | "item" | "item index", error?: unknown) {
  const fields = { page: `/item/${segment}`.slice(0, 240), step };
  if (error === undefined) console.warn("Item page timed out", fields);
  else console.warn("Item page data failed", { ...fields, error: error instanceof Error ? error.message : String(error) });
}

/** The item for the page: null when there's no such item, undefined when it couldn't be loaded in time. */
export const loadItem = cache(async (segment: string, gameMode: GameMode): Promise<ComposedItem | null | undefined> => {
  const reference = itemReference(segment);
  if (!reference) return null;
  const signal = AbortSignal.timeout(RENDER_TIMEOUT_MS);
  try {
    await waitForRenderSlot(signal);
  } catch {
    warnItemPage(segment, "render slot");
    return undefined;
  }
  try {
    return (await executeTarkovOperation(TARKOV_OPERATIONS.itemDetail, { gameMode, ...reference }, { signal })) as ComposedItem | null;
  } catch (error) {
    warnItemPage(segment, "item", signal.aborted ? undefined : error);
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const index = await Promise.race([
      getItemPageIndex("regular"),
      new Promise<"timed out">((resolve) => {
        timer = setTimeout(() => resolve("timed out"), RENDER_TIMEOUT_MS);
      }),
    ]);
    if (index === "timed out") {
      warnItemPage(slug, "item index");
      return undefined;
    }
    return index.pages.get(slug)?.indexing;
  } catch (error) {
    warnItemPage(slug, "item index", error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
