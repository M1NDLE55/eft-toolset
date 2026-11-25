import { createSerializationAdapter } from "@tanstack/react-router";

/**
 * Thrown when a page's main data couldn't be loaded or worked out in time, so the render fails
 * rather than caching a page without it: a background render keeps the cached copy, and a first
 * render answers with a server error. Imports nothing, so the browser can recognise it too.
 */
export class RenderDataUnavailableError extends Error {
  constructor(readonly label: string) {
    super(`${label}: data is temporarily unavailable.`);
    this.name = "RenderDataUnavailableError";
  }
}

/**
 * Start sends every other error to the browser as a plain Error with only its message. This keeps
 * the type, so the page there can tell "try again" from "broken" (route-status.tsx, the item page).
 */
export const renderDataUnavailableAdapter = createSerializationAdapter({
  key: "render-data-unavailable",
  test: (value): value is RenderDataUnavailableError => value instanceof RenderDataUnavailableError,
  toSerializable: (error) => ({ label: error.label }),
  fromSerializable: ({ label }) => new RenderDataUnavailableError(label),
});
