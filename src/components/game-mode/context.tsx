'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  readStore,
  subscribeStore,
  writeStore,
  type StoreDefinition,
} from '@/app/lib/storage/versioned-store';

export type GameMode = 'regular' | 'pve';

type GameModeContextValue = {
  gameMode: GameMode;
  hydrated: boolean;
  storageError: string;
  setGameMode: (mode: GameMode) => void;
  toggleGameMode: () => void;
};

const GameModeContext = createContext<GameModeContextValue | undefined>(
  undefined
);

const GAME_MODE_STORE: StoreDefinition<GameMode> = {
  key: 'eft-toolset:settings:game-mode',
  legacyKeys: ['eft-toolset:game-mode'],
  version: 1,
  defaultValue: () => 'regular',
  validate: (value): value is GameMode => value === 'regular' || value === 'pve',
};

export function GameModeProvider({ children }: { children: React.ReactNode }) {
  const [gameMode, setGameModeState] = useState<GameMode>('regular');
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    try {
      setGameModeState(readStore(GAME_MODE_STORE));
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : "Could not read game-mode settings.");
    } finally {
      setHydrated(true);
    }
    return subscribeStore(GAME_MODE_STORE.key, () => {
      try {
        setGameModeState(readStore(GAME_MODE_STORE));
      } catch (reason) {
        setStorageError(reason instanceof Error ? reason.message : "Could not read game-mode settings.");
      }
    });
  }, []);

  const setGameMode = useCallback((mode: GameMode) => {
    setGameModeState(mode);
    try {
      writeStore(GAME_MODE_STORE, mode);
      setStorageError("");
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : "Could not save game mode.");
    }
  }, []);

  const toggleGameMode = useCallback(() => {
    setGameMode(gameMode === 'regular' ? 'pve' : 'regular');
  }, [gameMode, setGameMode]);

  const value = useMemo<GameModeContextValue>(
    () => ({ gameMode, hydrated, storageError, setGameMode, toggleGameMode }),
    [gameMode, hydrated, setGameMode, storageError, toggleGameMode]
  );

  return (
    <GameModeContext.Provider value={value}>
      {children}
    </GameModeContext.Provider>
  );
}

export function useGameMode(): GameModeContextValue {
  const ctx = useContext(GameModeContext);
  if (!ctx) {
    throw new Error('useGameMode must be used within a GameModeProvider');
  }
  return ctx;
}
