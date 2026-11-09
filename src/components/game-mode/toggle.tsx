"use client";

import { cn } from "@/lib/utils";
import { useGameMode, type GameMode } from "./context";

const MODES: { value: GameMode; label: string; title: string }[] = [
  { value: "regular", label: "PVP", title: "Regular (PVP) prices and data" },
  { value: "pve", label: "PVE", title: "PVE prices and data" },
];

export function GameModeToggle() {
  const { gameMode, hydrated, setGameMode, storageError } = useGameMode();

  return (
    <div className="flex items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Game mode"
        className="flex h-10 border border-[#2a2a2a] bg-[#0c0c0c] p-0.5"
      >
        {MODES.map((mode) => {
          const active = hydrated && gameMode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={mode.title}
              onClick={() => setGameMode(mode.value)}
              className={cn(
                "min-w-11 px-2.5 text-[11px] font-bold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#9a8866]",
                active ? "bg-[#9a8866] text-black" : "text-[#888] hover:text-[#ccc]"
              )}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
      {storageError && (
        <span role="alert" title={storageError} className="text-[10px] text-red-300">
          Not saved
        </span>
      )}
    </div>
  );
}
