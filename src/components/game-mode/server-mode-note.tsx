"use client";

import type { GameMode } from "./mode";
import { MODE_LABEL, useServerModeSync } from "./use-server-mode-sync";

/**
 * Says which mode's prices a server-rendered page shows, and renders it again when the visitor's
 * mode changes. `rendered` is the mode the server rendered for; `prices` the mode the prices are
 * from, when the page fell back to the other mode's data.
 */
export function ServerModeNote({ rendered, prices = rendered }: { rendered: GameMode; prices?: GameMode }) {
  const { switching, current } = useServerModeSync(rendered);
  return (
    <span role="status" aria-live="polite">
      {switching ? `Loading ${MODE_LABEL[current]} prices…` : `Prices are live ${MODE_LABEL[prices]} prices.`}
    </span>
  );
}
