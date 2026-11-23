"use client";

import { useEffect } from "react";
import { useRouter } from "@/app/lib/navigation/hooks";
import { useGameMode } from "./context";
import { MODE_LABEL, type GameMode } from "./mode";

export { MODE_LABEL };

/**
 * For data the server rendered for one game mode: when the visitor's mode differs, render the
 * page again on the server, which reads the mode from the cookie the provider keeps in sync.
 */
export function useServerModeSync(rendered: GameMode) {
  const router = useRouter();
  const { gameMode: current, hydrated } = useGameMode();
  const switching = hydrated && current !== rendered;

  useEffect(() => {
    if (!switching) return;
    // Let the provider write the game mode cookie first.
    const timer = window.setTimeout(() => router.refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [switching, router]);

  return { switching, current };
}
