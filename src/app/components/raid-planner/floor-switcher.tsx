"use client";

import { useId, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import type { MapConfig } from "@/app/lib/raid-planner/types";
import { floorName, getFloorStack } from "@/app/lib/raid-planner/floors";
import { cn } from "@/lib/utils";
import { focusRing, overlayPanel } from "./ui";

interface FloorSwitcherProps {
  config: MapConfig;
  activeFloor: string | null;
  onChange: (floor: string | null) => void;
}

export function defaultFloor(config: MapConfig) {
  return config.floors.find((floor) => floor.show)?.id ?? null;
}

export function FloorSwitcher({ config, activeFloor, onChange }: FloorSwitcherProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (config.floors.length === 0) return null;

  const options = getFloorStack(config);
  const activeName = floorName(config, activeFloor);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          overlayPanel,
          "flex h-10 items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-widest text-[#c9b88d] sm:hidden",
          focusRing
        )}
      >
        <span className="sr-only">Map level: </span>
        {activeName}
        <ChevronsUpDown className="h-3.5 w-3.5 text-[#888]" aria-hidden />
      </button>
      <div
        id={listId}
        role="group"
        aria-label="Map level"
        className={cn(overlayPanel, "flex-col max-sm:order-first", expanded ? "flex" : "hidden sm:flex")}
      >
        {options.map((option) => {
          const active = option.id === activeFloor;
          return (
            <button
              key={option.id ?? "ground"}
              type="button"
              onClick={() => {
                onChange(option.id);
                setExpanded(false);
              }}
              aria-pressed={active}
              className={cn(
                "min-h-10 px-3 text-right text-[10px] font-bold uppercase tracking-widest transition-colors sm:min-h-8",
                focusRing,
                active ? "bg-[#9a8866] text-black" : "text-[#999] hover:bg-[#1a1a1a] hover:text-[#ddd]"
              )}
            >
              {option.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
