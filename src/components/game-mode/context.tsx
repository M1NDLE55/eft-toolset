"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useHydrated, useStore } from "@/app/lib/storage/use-store";

export type GameMode = "regular" | "pve";

type GameModeContextValue = {
  gameMode: GameMode;
  hydrated: boolean;
  storageError: string;
  setGameMode: (mode: GameMode) => void;
};

const GameModeContext = createContext<GameModeContextValue | undefined>(undefined);

const GAME_MODE_STORE: StoreDefinition<GameMode> = {
  key: "eft-toolset:settings:game-mode",
  legacyKeys: ["eft-toolset:game-mode"],
  version: 1,
  defaultValue: () => "regular",
  validate: (value): value is GameMode => value === "regular" || value === "pve",
};

export function GameModeProvider({ children }: { children: ReactNode }) {
  const storedMode = useStore(GAME_MODE_STORE);
  const hydrated = useHydrated();
  const [fallbackMode, setFallbackMode] = useState<GameMode | null>(null);
  const [storageError, setStorageError] = useState("");

  const setGameMode = (mode: GameMode) => {
    try {
      writeStore(GAME_MODE_STORE, mode);
      setFallbackMode(null);
      setStorageError("");
    } catch (reason) {
      setFallbackMode(mode);
      setStorageError(reason instanceof Error ? reason.message : "Could not save game mode.");
    }
  };

  const value: GameModeContextValue = {
    gameMode: fallbackMode ?? storedMode,
    hydrated,
    storageError,
    setGameMode,
  };

  return <GameModeContext.Provider value={value}>{children}</GameModeContext.Provider>;
}

export function useGameMode(): GameModeContextValue {
  const context = useContext(GameModeContext);
  if (!context) throw new Error("useGameMode must be used within a GameModeProvider");
  return context;
}
