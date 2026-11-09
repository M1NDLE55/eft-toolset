"use client";

import { useId, useState } from "react";
import { Check, Layers, LoaderCircle, X } from "lucide-react";
import type { LayerGroupOptions } from "@/app/lib/raid-planner/layer-options";
import { cn } from "@/lib/utils";
import { focusRing, iconButton, overlayPanel } from "./ui";

interface LayerPanelProps {
  groups: LayerGroupOptions[] | null;
  enabled: ReadonlySet<string>;
  onChange: (ids: string[], checked: boolean) => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

export function LayerPanel({ groups, enabled, onChange, loading, error, onRetry }: LayerPanelProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          overlayPanel,
          "flex h-10 items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-widest transition-colors hover:border-[#9a8866] hover:text-[#ddd] max-sm:w-10 max-sm:justify-center max-sm:px-0",
          focusRing,
          open ? "border-[#9a8866] text-[#ddd]" : "text-[#999]"
        )}
      >
        {loading ? (
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Layers className="h-4 w-4" aria-hidden />
        )}
        <span className="max-sm:sr-only">Layers</span>
        {enabled.size > 0 && (
          <span className="bg-[#9a8866] px-1.5 py-0.5 text-[10px] font-bold leading-none text-black max-sm:absolute max-sm:-right-1 max-sm:-top-1 max-sm:px-1">
            {enabled.size}
            <span className="sr-only"> enabled</span>
          </span>
        )}
      </button>

      {open && (
        <section
          id={panelId}
          aria-label="Map layers"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className={cn(
            overlayPanel,
            "pointer-events-auto absolute inset-x-2 top-full z-10 flex max-h-[min(70dvh,32rem)] flex-col bg-[#090909]/97 sm:left-auto sm:right-3 sm:w-72"
          )}
        >
          <header className="flex items-center justify-between border-b border-[#2a2a2a] pl-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">Map layers</h2>
            <div className="flex items-center">
              {enabled.size > 0 && (
                <button
                  type="button"
                  onClick={() => onChange(Array.from(enabled), false)}
                  className={cn(
                    "h-10 px-3 text-[10px] font-bold uppercase tracking-widest text-[#888] hover:text-[#ddd] sm:h-9",
                    focusRing
                  )}
                >
                  Clear
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className={iconButton}>
                <X className="h-4 w-4" aria-hidden />
                <span className="sr-only">Close layer panel</span>
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            {error ? (
              <div className="flex flex-col items-start gap-2 p-2">
                <p className="text-xs text-red-300">Map data could not be loaded.</p>
                <button
                  type="button"
                  onClick={onRetry}
                  className={cn(
                    "h-9 border border-[#2a2a2a] px-3 text-[10px] font-bold uppercase tracking-widest text-[#999] hover:border-[#9a8866] hover:text-[#ddd]",
                    focusRing
                  )}
                >
                  Retry
                </button>
              </div>
            ) : !groups ? (
              <div className="flex flex-col gap-1.5 p-1.5" aria-label="Loading map layers">
                {Array.from({ length: 8 }, (_, index) => (
                  <div key={index} className="h-7 animate-pulse bg-[#151515]" />
                ))}
              </div>
            ) : groups.length === 0 ? (
              <p className="p-2 text-xs text-[#888]">No layers are available for this map.</p>
            ) : (
              groups.map((group) => {
                const groupIds = group.options.map((option) => option.id);
                const allOn = groupIds.every((id) => enabled.has(id));
                return (
                  <div key={group.name} role="group" aria-label={group.name} className="mb-2 last:mb-0">
                    <div className="flex items-center justify-between px-1.5 pb-0.5 pt-1.5">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#777]">
                        {group.name}
                      </h3>
                      <button
                        type="button"
                        onClick={() => onChange(groupIds, !allOn)}
                        className={cn(
                          "min-h-10 px-1.5 text-[10px] uppercase tracking-widest text-[#777] hover:text-[#9a8866] sm:min-h-8",
                          focusRing
                        )}
                      >
                        {allOn ? "Hide all" : "Show all"}
                        <span className="sr-only"> {group.name}</span>
                      </button>
                    </div>
                    {group.options.map((option) => {
                      const checked = enabled.has(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => onChange([option.id], !checked)}
                          className={cn(
                            "flex min-h-10 w-full items-center gap-2.5 px-1.5 text-left transition-colors hover:bg-[#141414] sm:min-h-8",
                            focusRing
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center border",
                              checked ? "border-[#9a8866] bg-[#9a8866]" : "border-[#444]"
                            )}
                          >
                            {checked && <Check className="size-3 text-black" strokeWidth={3} />}
                          </span>
                          <span
                            className={cn("min-w-0 flex-1 truncate text-xs", checked ? "text-[#ddd]" : "text-[#999]")}
                          >
                            {option.label}
                          </span>
                          <span className="text-[10px] tabular-nums text-[#777]">{option.count}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </>
  );
}
