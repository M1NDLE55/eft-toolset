'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useGameMode } from './context';

export function GameModeToggle() {
  const { gameMode, setGameMode, storageError } = useGameMode();

  const label = gameMode === 'regular' ? 'PVP' : 'PVE';

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon">
            {label}
            <span className="sr-only">Select game mode</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setGameMode('regular')}>
            PVP
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setGameMode('pve')}>
            PVE
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {storageError && (
        <span role="alert" title={storageError} className="ml-2 text-[10px] text-red-300">
          Not saved
        </span>
      )}
    </div>
  );
}
