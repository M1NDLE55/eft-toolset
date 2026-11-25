import { RenderDataUnavailableError } from "@/app/lib/render-errors";
import type { PageErrorKind } from "./catalog";

// What browsers and Vite say when a code chunk doesn't download (Chromium, Firefox, Safari, Vite's
// CSS preload). The module map keeps the failure, so only a fresh page load fetches it again.
const CHUNK_LOAD = /^(?:Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS)/;
// fetch()'s TypeError when the request never got an answer (Chromium, Firefox, Safari).
const NETWORK = /^(?:Failed to fetch|NetworkError when attempting to fetch resource|Load failed)/;

/** Sorts a page's error into one of the closed kinds; the message is read here and never recorded. */
export function pageErrorKind(error: unknown): PageErrorKind {
  if (error instanceof RenderDataUnavailableError) return "unavailable";
  const message = error instanceof Error ? error.message : "";
  if (CHUNK_LOAD.test(message)) return "chunk_load";
  if (error instanceof TypeError && NETWORK.test(message)) return "network";
  return "crash";
}
