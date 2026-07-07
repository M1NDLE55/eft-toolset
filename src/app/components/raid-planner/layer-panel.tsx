"use client";

import { useState } from "react";
import { Check, Layers, X } from "lucide-react";
import type { LayerGroupOptions } from "@/app/lib/raid-planner/layer-options";
import { cn } from "@/lib/utils";

interface LayerPanelProps {
  groups: LayerGroupOptions[] | null;
  enabled: Set<string>;
  onChange: (ids: string[], checked: boolean) => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

export function LayerPanel({
  groups,
  enabled,
  onChange,
  loading,
  error,
  onRetry,
}: LayerPanelProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 border border-[#2a2a2a] bg-[#090909]/90 px-3 py-2 text-[10px] uppercase tracking-widest text-[#777] backdrop-blur-sm transition-colors hover:border-[#9a8866] hover:text-[#ccc]"
      >
        <Layers className="h-4 w-4" />
        Layers
        {enabled.size > 0 && (
          <span className="bg-[#9a8866] px-1.5 py-0.5 text-[10px] font-bold text-black">
            {enabled.size}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex max-h-[70dvh] w-64 flex-col border border-[#2a2a2a] bg-[#090909]/95 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-[#2a2a2a] px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#9a8866]">
          Layers
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[#777] transition-colors hover:text-[#ccc]"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close layer panel</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-1 py-2 text-[10px] uppercase tracking-widest text-[#555]">
            Loading map data…
          </p>
        ) : error ? (
          <div className="flex flex-col gap-2 px-1 py-2">
            <p className="text-[10px] uppercase tracking-widest text-[#a04f4f]">
              Failed to load map data
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="self-start border border-[#2a2a2a] px-2 py-1 text-[10px] uppercase tracking-widest text-[#777] hover:border-[#9a8866] hover:text-[#ccc]"
            >
              Retry
            </button>
          </div>
        ) : (
          groups?.map((group) => {
            const groupIds = group.options.map((option) => option.id);
            const allOn = groupIds.every((id) => enabled.has(id));

            return (
              <div key={group.name} className="mb-2 last:mb-0">
                <button
                  type="button"
                  onClick={() => onChange(groupIds, !allOn)}
                  className="w-full px-1 py-1 text-left text-[10px] font-bold uppercase tracking-widest text-[#777] transition-colors hover:text-[#9a8866]"
                  title={allOn ? "Hide all" : "Show all"}
                >
                  {group.name}
                </button>
                {group.options.map((option) => {
                  const checked = enabled.has(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onChange([option.id], !checked)}
                      className="flex w-full items-center gap-2 px-1 py-1 text-left transition-colors hover:bg-[#141414]"
                    >
                      <span
                        className={cn(
                          "flex h-3.5 w-3.5 shrink-0 items-center justify-center border",
                          checked
                            ? "border-[#9a8866] bg-[#9a8866]"
                            : "border-[#3a3a3a]"
                        )}
                      >
                        {checked && <Check className="h-3 w-3 text-black" />}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-xs",
                          checked ? "text-[#ccc]" : "text-[#777]"
                        )}
                      >
                        {option.label}
                      </span>
                      <span className="text-[10px] text-[#555]">
                        {option.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
