'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type GameMode = 'regular' | 'pve';

type GameModeContextValue = {
  gameMode: GameMode;
  setGameMode: (mode: GameMode) => void;
  toggleGameMode: () => void;
};

const GameModeContext = createContext<GameModeContextValue | undefined>(
  undefined
);

const STORAGE_KEY = 'eft-toolset:game-mode';

export function GameModeProvider({ children }: { children: React.ReactNode }) {
  const [gameMode, setGameModeState] = useState<GameMode>('regular');

  useEffect(() => {
    try {
      const stored =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(STORAGE_KEY)
          : null;
      if (stored === 'pve' || stored === 'regular') {
        setGameModeState(stored);
      }
    } catch (_) {
      // ignore storage errors
    }
  }, []);

  const setGameMode = useCallback((mode: GameMode) => {
    setGameModeState(mode);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, mode);
      }
    } catch (_) {
      // ignore storage errors
    }
  }, []);

  const toggleGameMode = useCallback(() => {
    setGameMode(gameMode === 'regular' ? 'pve' : 'regular');
  }, [gameMode, setGameMode]);

  const value = useMemo<GameModeContextValue>(
    () => ({ gameMode, setGameMode, toggleGameMode }),
    [gameMode, setGameMode, toggleGameMode]
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
