"use client";

import Link from "next/link";
import { ChevronRight, Layers } from "lucide-react";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import type { MapConfig } from "@/app/lib/raid-planner/types";
import { prefetchMap } from "@/app/lib/raid-planner/prefetch";
import { useGameMode } from "@/components/game-mode/context";
import { cn } from "@/lib/utils";
import { focusRing } from "./ui";

const tileClass = cn(
  "group flex min-h-16 items-center justify-between gap-2 border border-[#2a2a2a] bg-[#090909] px-3 py-2.5 text-left transition-colors hover:border-[#9a8866] hover:bg-[#0e0d0b] disabled:opacity-50",
  focusRing
);

function levelLabel(config: MapConfig) {
  const levels = config.floors.length + 1;
  return `${levels} ${levels === 1 ? "level" : "levels"}`;
}

function TileBody({ config }: { config: MapConfig }) {
  return (
    <>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="line-clamp-2 text-xs font-bold uppercase tracking-widest text-[#ccc] group-hover:text-[#c9b88d]">
          {config.name}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#777]">
          <Layers className="h-3 w-3" aria-hidden />
          {levelLabel(config)}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[#555] transition-colors group-hover:text-[#9a8866]" aria-hidden />
    </>
  );
}

const gridClass = "grid grid-cols-2 gap-2 sm:grid-cols-3";

export function MapPicker({ disabled, onPick }: { disabled?: boolean; onPick: (config: MapConfig) => void }) {
  const { gameMode } = useGameMode();
  return (
    <div role="group" aria-label="Choose a map" className={gridClass}>
      {mapConfigs.map((config) => (
        <button
          key={config.key}
          type="button"
          disabled={disabled}
          onClick={() => onPick(config)}
          onPointerEnter={() => prefetchMap(config, gameMode)}
          onFocus={() => prefetchMap(config, gameMode)}
          className={tileClass}
        >
          <TileBody config={config} />
        </button>
      ))}
    </div>
  );
}

export function MapLinks() {
  const { gameMode } = useGameMode();
  return (
    <ul className={cn(gridClass, "lg:grid-cols-4")}>
      {mapConfigs.map((config) => (
        <li key={config.key} className="contents">
          <Link
            href={`/raid-planner/map/${config.key}`}
            onPointerEnter={() => prefetchMap(config, gameMode)}
            onFocus={() => prefetchMap(config, gameMode)}
            onTouchStart={() => prefetchMap(config, gameMode)}
            className={tileClass}
          >
            <TileBody config={config} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
