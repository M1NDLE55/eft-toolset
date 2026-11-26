import { RenderDataUnavailableError } from "@/app/lib/render-errors";
import { runTarkovRead, waitForRenderSlot, releaseRenderSlot } from "./tarkov-server";

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
    return await runTarkovRead(work, { signal, staleWaitMs });
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
