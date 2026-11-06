import { cookies } from "next/headers";
import { cache } from "react";
import { customDecodeURI } from "@/app/lib/URIEncoding";
import { isItemSlug } from "@/app/lib/item-links";
import { executeTarkovOperation, releaseOperationSlot, tryAcquireOperationSlot } from "@/app/lib/api/tarkov-server";
import { TARKOV_OPERATIONS } from "@/app/lib/api/operations";
import { GAME_MODE_COOKIE, isGameMode, type GameMode } from "@/components/game-mode/mode";
import type { ComposedItem } from "@/app/lib/cache/types";

const SERVER_RENDER_TIMEOUT_MS = 2_500;

export async function requestGameMode(): Promise<GameMode> {
  const value = (await cookies()).get(GAME_MODE_COOKIE)?.value;
  return isGameMode(value) ? value : "regular";
}

export const loadItem = cache(async (segment: string, gameMode: GameMode): Promise<ComposedItem | null | undefined> => {
  const reference = isItemSlug(segment) ? { slug: segment } : { name: customDecodeURI(segment) };
  if ("name" in reference && !reference.name) return null;
  if (!tryAcquireOperationSlot()) return undefined;
  try {
    return (await executeTarkovOperation(
      TARKOV_OPERATIONS.itemDetail,
      { gameMode, ...reference },
      { signal: AbortSignal.timeout(SERVER_RENDER_TIMEOUT_MS) }
    )) as ComposedItem | null;
  } catch {
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
