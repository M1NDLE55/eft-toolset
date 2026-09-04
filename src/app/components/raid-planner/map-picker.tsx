"use client";

import { Layers } from "lucide-react";
import { mapConfigs } from "@/app/lib/raid-planner/maps-config";
import type { MapConfig } from "@/app/lib/raid-planner/types";

interface MapPickerProps {
  disabled?: boolean;
  onPick: (config: MapConfig) => void;
}

export function MapPicker({ disabled, onPick }: MapPickerProps) {
  return (
    <div className="grid max-h-[50dvh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
      {mapConfigs.map((config) => (
        <button
          key={config.key}
          type="button"
          disabled={disabled}
          onClick={() => onPick(config)}
          className="group flex flex-col gap-1 border border-[#2a2a2a] bg-[#090909] p-3 text-left transition-colors hover:border-[#9a8866] disabled:opacity-50"
        >
          <span className="text-sm font-bold uppercase tracking-widest text-[#ccc] group-hover:text-[#9a8866]">
            {config.name}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#888]">
            <Layers className="h-3 w-3" />
            {config.floors.length + 1}{" "}
            {config.floors.length === 0 ? "level" : "levels"}
          </span>
        </button>
      ))}
    </div>
  );
}
