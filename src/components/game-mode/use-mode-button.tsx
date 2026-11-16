"use client";

import { useGameMode } from "./context";
import { MODE_LABEL } from "./use-server-mode-sync";
import type { GameMode } from "./mode";

/** Switches the site to a game mode, for pages about one mode. Hidden once that mode is on. */
export function UseModeButton({ mode }: { mode: GameMode }) {
  const { gameMode, hydrated, setGameMode } = useGameMode();
  if (!hydrated || gameMode === mode) return null;
  return (
    <button
      type="button"
      onClick={() => setGameMode(mode)}
      className="w-fit border border-[#9a8866] px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[#e6d9b8] hover:bg-[#1a1610] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
    >
      Use {MODE_LABEL[mode]} prices everywhere
    </button>
  );
}
