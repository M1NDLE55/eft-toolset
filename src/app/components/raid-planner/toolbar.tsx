"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronsDown,
  ChevronUp,
  EllipsisVertical,
  Eraser,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Redo2,
  Route,
  Ruler,
  StickyNote,
  Undo2,
} from "lucide-react";
import type { PlanTool } from "@/app/lib/raid-planner/types";
import { PLAN_COLORS } from "@/app/lib/raid-planner/types";
import type { ToolbarPrefs, ToolbarSide } from "@/app/lib/raid-planner/toolbar-store";
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
  "flex size-11 items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-30 sm:size-10",
  focusRing
);

const idleButton = "text-[#999] hover:bg-[#1a1a1a] hover:text-[#ddd]";

const optionButton = cn(
  "flex min-h-11 items-center gap-2 px-3 text-left text-[10px] font-bold uppercase tracking-widest text-[#bbb] transition-colors hover:bg-[#161616] hover:text-[#ddd]",
  focusRing
);

const SIDES: { side: ToolbarSide; label: string }[] = [
  { side: "left", label: "Left hand" },
  { side: "right", label: "Right hand" },
];

interface ToolbarProps {
  tool: PlanTool;
  onToolChange: (tool: PlanTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  prefs: ToolbarPrefs;
  onPrefsChange: (changes: Partial<ToolbarPrefs>) => void;
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
  prefs,
  onPrefsChange,
}: ToolbarProps) {
  const active = TOOLS.find((entry) => entry.tool === tool) ?? TOOLS[0];
  const ActiveIcon = active.icon;
  const collapsed = prefs.collapsed;
  const hiddenWhenCollapsed = collapsed ? "max-sm:hidden" : "";

  return (
    <div
      className={cn(
        "flex items-end gap-2 sm:flex-col sm:items-start",
        prefs.side === "right" ? "max-sm:flex-row-reverse" : "max-sm:flex-row"
      )}
    >
      <div
        role="toolbar"
        aria-label="Plan tools"
        aria-orientation="vertical"
        className={cn(overlayPanel, "relative z-10 flex flex-col")}
      >
        {collapsed && (
          <button
            type="button"
            title={`Show all tools (current: ${active.label})`}
            onClick={() => onPrefsChange({ collapsed: false })}
            aria-expanded={false}
            className={cn(toolButton, "relative bg-[#9a8866] text-black sm:hidden")}
          >
            <ChevronUp className="absolute left-1/2 top-0.5 h-3 w-3 -translate-x-1/2 opacity-70" aria-hidden />
            <ActiveIcon className="mt-1.5 h-4 w-4" aria-hidden />
            <span className="sr-only">Show all tools. Current tool: {active.label}</span>
          </button>
        )}
        {TOOLS.map(({ tool: id, label, shortcut, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={`${label} (${shortcut})`}
            aria-keyshortcuts={shortcut}
            onClick={() => onToolChange(id)}
            aria-pressed={id === tool}
            className={cn(toolButton, hiddenWhenCollapsed, id === tool ? "bg-[#9a8866] text-black" : idleButton)}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="sr-only">{label}</span>
          </button>
        ))}
        <span aria-hidden className="mx-2 my-0.5 h-px bg-[#2a2a2a]" />
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          aria-keyshortcuts="Control+Z Meta+Z"
          onClick={onUndo}
          disabled={!canUndo}
          className={cn(toolButton, idleButton)}
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
          className={cn(toolButton, idleButton)}
        >
          <Redo2 className="h-4 w-4" aria-hidden />
          <span className="sr-only">Redo</span>
        </button>
        <span aria-hidden className={cn("mx-2 my-0.5 h-px bg-[#2a2a2a] sm:hidden", hiddenWhenCollapsed)} />
        <ToolbarOptions prefs={prefs} onPrefsChange={onPrefsChange} className={hiddenWhenCollapsed} />
      </div>

      {COLOR_TOOLS.includes(tool) && (
        <div
          role="group"
          aria-label="Drawing color"
          className={cn(overlayPanel, "flex flex-col sm:grid sm:grid-cols-2", hiddenWhenCollapsed)}
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

function ToolbarOptions({
  prefs,
  onPrefsChange,
  className,
}: {
  prefs: ToolbarPrefs;
  onPrefsChange: (changes: Partial<ToolbarPrefs>) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function choose(changes: Partial<ToolbarPrefs>) {
    onPrefsChange(changes);
    if (changes.collapsed) setOpen(false);
  }

  return (
    <div
      ref={containerRef}
      className={cn("relative sm:hidden", className)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        title="Toolbar options"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(toolButton, open ? "bg-[#1a1a1a] text-[#e6d9b8]" : idleButton)}
      >
        <EllipsisVertical className="h-4 w-4" aria-hidden />
        <span className="sr-only">Toolbar options</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Toolbar options"
          className={cn(
            overlayPanel,
            "absolute bottom-0 z-10 flex w-52 flex-col bg-[#090909]/97 p-1",
            prefs.side === "right" ? "right-full mr-2" : "left-full ml-2"
          )}
        >
          <button type="button" onClick={() => choose({ collapsed: true })} className={optionButton}>
            <ChevronsDown className="h-4 w-4 text-[#9a8866]" aria-hidden />
            Collapse toolbar
          </button>
          <span aria-hidden className="-mx-1 my-1 h-px bg-[#1d1d1d]" />
          <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-[#777]">Toolbar side</p>
          <div className="grid grid-cols-2 gap-1">
            {SIDES.map(({ side, label }) => (
              <button
                key={side}
                type="button"
                aria-pressed={prefs.side === side}
                onClick={() => choose({ side })}
                className={cn(
                  "min-h-11 text-[10px] font-bold uppercase tracking-widest transition-colors",
                  focusRing,
                  prefs.side === side ? "bg-[#9a8866] text-black" : "border border-[#2a2a2a] text-[#999] hover:text-[#ddd]"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
