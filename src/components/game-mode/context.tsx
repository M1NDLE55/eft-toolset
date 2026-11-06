"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useHydrated, useStore } from "@/app/lib/storage/use-store";

import { GAME_MODE_COOKIE, isGameMode, type GameMode } from "./mode";

export type { GameMode };

function writeGameModeCookie(mode: GameMode) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${GAME_MODE_COOKIE}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

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
  validate: isGameMode,
};

export function GameModeProvider({ children }: { children: ReactNode }) {
  const storedMode = useStore(GAME_MODE_STORE);
  const hydrated = useHydrated();
  const [fallbackMode, setFallbackMode] = useState<GameMode | null>(null);
  const [storageError, setStorageError] = useState("");
  const gameMode = fallbackMode ?? storedMode;

  useEffect(() => {
    if (hydrated) writeGameModeCookie(gameMode);
  }, [gameMode, hydrated]);

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
    gameMode,
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
