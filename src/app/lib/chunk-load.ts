import { failedChunkUrl, pageErrorKind } from "@/app/lib/usage/page-error";

/**
 * Loads a lazily split module, and when its download fails tries once more before giving up.
 *
 * The browser keeps a failed dynamic import's failure for the rest of the page's life, so asking for
 * the same URL again fails at once without a request. The second try therefore asks for the script
 * the browser named, with a query that makes its URL new (static assets ignore the query), so it is
 * fetched afresh. Without a script URL in the error (Safari, or a stylesheet that didn't preload) it
 * runs the import again, which re-requests what can be re-requested.
 *
 * `retry` makes the first try the fresh one: for a Retry button, after an earlier failure.
 */
export async function importChunk<M>(load: () => Promise<M>, options: { retry?: unknown } = {}): Promise<M> {
  if (options.retry !== undefined) return importAfresh(load, options.retry);
  try {
    return await load();
  } catch (error) {
    if (pageErrorKind(error) !== "chunk_load") throw error;
    return importAfresh(load, error);
  }
}

function importAfresh<M>(load: () => Promise<M>, error: unknown): Promise<M> {
  const url = failedChunkUrl(error);
  if (!url) return load();
  const fresh = `${url}${url.includes("?") ? "&" : "?"}retry=${Date.now().toString(36)}`;
  return import(/* @vite-ignore */ fresh) as Promise<M>;
}
