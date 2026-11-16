import { cookies, headers } from "next/headers";
import { userAgent } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { GAME_MODE_COOKIE, isGameMode, type GameMode } from "@/components/game-mode/mode";
import { releaseOperationSlot, runTarkovRead, tryAcquireOperationSlot } from "./tarkov-server";

export const SERVER_RENDER_TIMEOUT_MS = 2_500;
// Crawlers wait longer: a page they see without its data is worth far less than a slower one.
export const CRAWLER_RENDER_TIMEOUT_MS = 9_000;

/** The visitor's game mode, from the cookie the client keeps in sync with its stored setting. */
export async function requestGameMode(): Promise<GameMode> {
  const value = (await cookies()).get(GAME_MODE_COOKIE)?.value;
  return isGameMode(value) ? value : "regular";
}

export const isCrawlerRequest = cache(async () => userAgent({ headers: await headers() }).isBot);

export async function renderTimeoutMs() {
  return (await isCrawlerRequest()) ? CRAWLER_RENDER_TIMEOUT_MS : SERVER_RENDER_TIMEOUT_MS;
}

/**
 * Runs a tarkov-server read while rendering a page. Returns undefined when the server is busy,
 * the read fails, or it takes too long, so the page can render without the data.
 */
export async function readForRender<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
  // Read the request first: outside a request, Next must see this throw to render dynamically.
  const timeout = await renderTimeoutMs();
  if (!tryAcquireOperationSlot()) {
    console.warn(`${label} rendered without its data: the server is busy.`);
    return undefined;
  }
  try {
    return await runTarkovRead(work, { signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    unstable_rethrow(error);
    console.warn(`${label} rendered without its data:`, error instanceof Error ? error.message : error);
    return undefined;
  } finally {
    releaseOperationSlot();
  }
}
