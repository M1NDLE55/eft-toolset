"use client";

import type { GameMode } from "./mode";
import { MODE_LABEL, useServerModeSync } from "./use-server-mode-sync";

/** Says which mode's prices a server-rendered page shows, and renders it again when that changes. */
export function ServerModeNote({ rendered }: { rendered: GameMode }) {
  const { switching, current } = useServerModeSync(rendered);
  return (
    <span role="status" aria-live="polite">
      {switching ? `Loading ${MODE_LABEL[current]} prices…` : `Prices are live ${MODE_LABEL[rendered]} prices.`}
    </span>
  );
}
