"use client";

import { useEffect } from "react";
import { ensureLayerIconSprite, iconSymbolId, layerIconId } from "@/app/lib/raid-planner/layer-icons";
import { cn } from "@/lib/utils";

/** A layer's map icon, decorative next to its name; the shared sprite is added to the page on mount. */
export function LayerIcon({ layerId, className }: { layerId: string; className?: string }) {
  useEffect(() => ensureLayerIconSprite(), []);
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false" className={cn("size-5 shrink-0 overflow-visible", className)}>
      <use href={`#${iconSymbolId(layerIconId(layerId))}`} />
    </svg>
  );
}
