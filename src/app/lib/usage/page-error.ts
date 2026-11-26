import { RenderDataUnavailableError } from "@/app/lib/render-errors";
import type { PageErrorKind } from "./catalog";

// What browsers and Vite say when a code chunk doesn't download (Chromium, Firefox, Safari, Vite's
// CSS preload). The module map keeps the failure, so only a fresh page load fetches it again.
const CHUNK_LOAD = /^(?:Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS)/;
// fetch()'s TypeError when the request never got an answer (Chromium, Firefox, Safari).
const NETWORK = /^(?:Failed to fetch|NetworkError when attempting to fetch resource|Load failed)/;

/**
 * The error's name and message, read the way the browser's console would: from any object that has
 * them, so an error from another realm (an iframe, a worker) or a plain object thrown as one is
 * still read. A thrown string is its own message. Anything else has neither.
 */
function describe(error: unknown): { name: string; message: string } {
  if (typeof error === "string") return { name: "", message: error };
  if (typeof error !== "object" || error === null) return { name: "", message: "" };
  const { name, message } = error as { name?: unknown; message?: unknown };
  return { name: typeof name === "string" ? name : "", message: typeof message === "string" ? message : "" };
}

/**
 * Sorts a page's error into one of the closed kinds; the message is read here and never recorded.
 * Total: whatever was thrown (a string, null, an object with a throwing getter), the answer is a
 * kind, and anything it doesn't recognise is a crash.
 */
export function pageErrorKind(error: unknown): PageErrorKind {
  try {
    if (error instanceof RenderDataUnavailableError) return "unavailable";
    const { name, message } = describe(error);
    if (name === "RenderDataUnavailableError") return "unavailable";
    if (CHUNK_LOAD.test(message)) return "chunk_load";
    if ((error instanceof TypeError || name === "TypeError") && NETWORK.test(message)) return "network";
  } catch {
    // A getter that throws, a revoked proxy: nothing to read.
  }
  return "crash";
}

/** The script a failed dynamic import named, if the browser said which (Chromium and Firefox do). */
export function failedChunkUrl(error: unknown): string | null {
  try {
    const match = /dynamically imported module:?\s*(\S+\.js)\b/.exec(describe(error).message);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
