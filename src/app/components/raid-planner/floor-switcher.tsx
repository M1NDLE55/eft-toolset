"use client";

import type { MapConfig } from "@/app/lib/raid-planner/types";
import { cn } from "@/lib/utils";

interface FloorSwitcherProps {
  config: MapConfig;
  activeFloor: string | null;
  onChange: (floor: string | null) => void;
}

export function FloorSwitcher({
  config,
  activeFloor,
  onChange,
}: FloorSwitcherProps) {
  if (config.floors.length === 0) return null;

  const options: { id: string | null; name: string }[] = [
    { id: null, name: "Ground" },
    ...config.floors.map((floor) => ({ id: floor.id, name: floor.name })),
  ];

  return (
    <div className="flex flex-col border border-[#2a2a2a] bg-[#090909]/90 backdrop-blur-sm">
      {options.map((option) => (
        <button
          key={option.id ?? "ground"}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            "px-3 py-2 text-left text-[10px] uppercase tracking-widest transition-colors",
            option.id === activeFloor
              ? "bg-[#9a8866] text-black"
              : "text-[#777] hover:bg-[#1a1a1a] hover:text-[#ccc]"
          )}
        >
          {option.name}
        </button>
      ))}
    </div>
  );
}
