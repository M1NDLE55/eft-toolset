"use client";

import {
  Eraser,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Route,
  Ruler,
  StickyNote,
} from "lucide-react";
import type { PlanTool } from "@/app/lib/raid-planner/types";
import { PLAN_COLORS } from "@/app/lib/raid-planner/types";
import { cn } from "@/lib/utils";

const TOOLS: { tool: PlanTool; label: string; icon: typeof Pencil }[] = [
  { tool: "select", label: "Select / pan", icon: MousePointer2 },
  { tool: "route", label: "Route waypoints", icon: Route },
  { tool: "pen", label: "Freehand pen", icon: Pencil },
  { tool: "arrow", label: "Arrow", icon: MoveUpRight },
  { tool: "note", label: "Note pin", icon: StickyNote },
  { tool: "eraser", label: "Eraser", icon: Eraser },
  { tool: "measure", label: "Measure distance", icon: Ruler },
];

const COLOR_TOOLS: PlanTool[] = ["pen", "arrow", "note"];

interface ToolbarProps {
  tool: PlanTool;
  onToolChange: (tool: PlanTool) => void;
  color: string;
  onColorChange: (color: string) => void;
}

export function Toolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
}: ToolbarProps) {
  return (
    <div role="toolbar" aria-label="Plan tools" className="flex flex-row border border-[#2a2a2a] bg-[#090909]/90 backdrop-blur-sm sm:flex-col">
      {TOOLS.map(({ tool: id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          onClick={() => onToolChange(id)}
          aria-pressed={id === tool}
          className={cn(
            "flex h-9 w-9 items-center justify-center transition-colors",
            id === tool
              ? "bg-[#9a8866] text-black"
              : "text-[#888] hover:bg-[#1a1a1a] hover:text-[#ccc]"
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="sr-only">{label}</span>
        </button>
      ))}

      {COLOR_TOOLS.includes(tool) && (
        <div className="flex items-center gap-1 border-l border-[#2a2a2a] p-1.5 sm:grid sm:grid-cols-2 sm:border-l-0 sm:border-t">
          {PLAN_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              title={swatch}
              onClick={() => onColorChange(swatch)}
              aria-pressed={swatch === color}
              className={cn(
                "h-4 w-4 border",
                swatch === color ? "border-white" : "border-transparent"
              )}
              style={{ backgroundColor: swatch }}
            >
              <span className="sr-only">Use color {swatch}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
