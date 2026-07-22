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

  useEffect(() => {
    try {
      setGameModeState(readStore(GAME_MODE_STORE));
    } catch {
      // ignore storage errors
    } finally {
      setHydrated(true);
    }
    return subscribeStore(GAME_MODE_STORE.key, () => {
      setGameModeState(readStore(GAME_MODE_STORE));
    });
  }, []);

  const setGameMode = useCallback((mode: GameMode) => {
    setGameModeState(mode);
    try {
      writeStore(GAME_MODE_STORE, mode);
    } catch {
      // ignore storage errors
    }
  }, []);

  const toggleGameMode = useCallback(() => {
    setGameMode(gameMode === 'regular' ? 'pve' : 'regular');
  }, [gameMode, setGameMode]);

  const value = useMemo<GameModeContextValue>(
    () => ({ gameMode, hydrated, setGameMode, toggleGameMode }),
    [gameMode, hydrated, setGameMode, toggleGameMode]
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
