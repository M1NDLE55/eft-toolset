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
  const { gameMode, setGameMode, toggleGameMode } = useGameMode();

  const label = gameMode === 'regular' ? 'PVP' : 'PVE';
  const current = gameMode === 'regular' ? 'pvp' : 'pve';

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" onClick={toggleGameMode}>
            {label}
            <span className="sr-only">Toggle game mode</span>
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
    </div>
  );
}
