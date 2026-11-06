"use client";

import {
  Eraser,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Route,
  Ruler,
  StickyNote,
  Redo2,
  Undo2,
} from "lucide-react";
import type { PlanTool } from "@/app/lib/raid-planner/types";
import { PLAN_COLORS } from "@/app/lib/raid-planner/types";
import { cn } from "@/lib/utils";
import { focusRing, overlayPanel } from "./ui";

export const TOOLS: { tool: PlanTool; label: string; shortcut: string; icon: typeof Pencil }[] = [
  { tool: "select", label: "Select and pan", shortcut: "V", icon: MousePointer2 },
  { tool: "route", label: "Route waypoints", shortcut: "R", icon: Route },
  { tool: "pen", label: "Freehand pen", shortcut: "P", icon: Pencil },
  { tool: "arrow", label: "Arrow", shortcut: "A", icon: MoveUpRight },
  { tool: "note", label: "Note pin", shortcut: "N", icon: StickyNote },
  { tool: "eraser", label: "Eraser", shortcut: "E", icon: Eraser },
  { tool: "measure", label: "Measure distance", shortcut: "M", icon: Ruler },
];

const COLOR_TOOLS: PlanTool[] = ["pen", "arrow", "note"];

const COLOR_NAMES: Record<(typeof PLAN_COLORS)[number], string> = {
  "#c8b384": "Sand",
  "#9bc878": "Green",
  "#e2a852": "Amber",
  "#d46b6b": "Red",
  "#78b6d2": "Blue",
  "#f0f0f0": "White",
};

const toolButton = cn(
  "flex size-10 items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-30",
  focusRing
);

interface ToolbarProps {
  tool: PlanTool;
  onToolChange: (tool: PlanTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function Toolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: ToolbarProps) {
  return (
    <div className="flex flex-col-reverse items-center gap-2 sm:flex-col sm:items-start">
      <div
        role="toolbar"
        aria-label="Plan tools"
        className={cn(overlayPanel, "flex flex-row sm:flex-col")}
      >
        {TOOLS.map(({ tool: id, label, shortcut, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={`${label} (${shortcut})`}
            aria-keyshortcuts={shortcut}
            onClick={() => onToolChange(id)}
            aria-pressed={id === tool}
            className={cn(
              toolButton,
              id === tool ? "bg-[#9a8866] text-black" : "text-[#999] hover:bg-[#1a1a1a] hover:text-[#ddd]"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="sr-only">{label}</span>
          </button>
        ))}
        <span aria-hidden className="mx-0.5 my-2 w-px bg-[#2a2a2a] sm:mx-2 sm:my-0.5 sm:h-px sm:w-auto" />
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          aria-keyshortcuts="Control+Z Meta+Z"
          onClick={onUndo}
          disabled={!canUndo}
          className={cn(toolButton, "text-[#999] hover:bg-[#1a1a1a] hover:text-[#ddd]")}
        >
          <Undo2 className="h-4 w-4" aria-hidden />
          <span className="sr-only">Undo</span>
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Shift+Z)"
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
          onClick={onRedo}
          disabled={!canRedo}
          className={cn(toolButton, "text-[#999] hover:bg-[#1a1a1a] hover:text-[#ddd]")}
        >
          <Redo2 className="h-4 w-4" aria-hidden />
          <span className="sr-only">Redo</span>
        </button>
      </div>

      {COLOR_TOOLS.includes(tool) && (
        <div
          role="group"
          aria-label="Drawing color"
          className={cn(overlayPanel, "flex flex-row sm:grid sm:grid-cols-2")}
        >
          {PLAN_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              title={COLOR_NAMES[swatch]}
              onClick={() => onColorChange(swatch)}
              aria-pressed={swatch === color}
              className={cn(toolButton, "sm:size-5")}
            >
              <span
                aria-hidden
                className={cn(
                  "block size-5 border-2 sm:size-full sm:border",
                  swatch === color ? "border-white" : "border-black/40"
                )}
                style={{ backgroundColor: swatch }}
              />
              <span className="sr-only">{COLOR_NAMES[swatch]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
