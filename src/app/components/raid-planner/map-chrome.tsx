import type { ReactNode } from "react";
import type { MapConfig } from "@/app/lib/raid-planner/types";
import { cn } from "@/lib/utils";
import { overlayPanel } from "./ui";

export const MAP_STAGE_CLASS = "relative isolate h-[calc(100dvh-65px)] min-h-88 w-full overflow-hidden bg-[#050505]";

export const SVG_MAP_SOURCE = "https://github.com/the-hideout/tarkov-dev-svg-maps";
export const CC_BY_NC_SA_4 = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
/** How we change the SVG artwork: only the active floor shows, and globals.css recolours it. */
export const SVG_MAP_CHANGES = "floor visibility, recoloured";

const linkClass =
  "inline-block py-1 text-[#b8a77e] underline underline-offset-2 hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:outline-[#9a8866] sm:py-0.5";
const separator = <span aria-hidden className="px-1 text-[#555]">·</span>;

interface MapAttributionProps {
  config: MapConfig;
  className?: string;
  /** "overlay" floats over the map; "inline" sits in normal page flow. */
  placement?: "overlay" | "inline";
}

/**
 * Credits the base map. The SVG maps are CC BY-NC-SA 4.0, so their credit names the
 * author, links the source and the licence, and says what we change (section 3(a)).
 */
export function MapAttribution({ config, className, placement = "overlay" }: MapAttributionProps) {
  if (!config.author) return null;
  const boxClass = cn(
    "text-3xs leading-4 text-[#999]",
    placement === "overlay" &&
      "pointer-events-auto absolute z-999 max-w-[calc(100%-1rem)] bg-[#090909]/85 px-2 py-0.5 backdrop-blur-xs",
    className
  );

  if (!config.svgPath) {
    return (
      <p className={cn(boxClass, "uppercase tracking-widest")}>
        Map by{" "}
        {config.authorLink ? (
          <a href={config.authorLink} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {config.author}
          </a>
        ) : (
          config.author
        )}
      </p>
    );
  }

  return (
    <p className={boxClass}>
      <span>
        Map by {config.author}
        {separator}
        <a
          href={SVG_MAP_SOURCE}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          aria-label="Source: tarkov-dev-svg-maps on GitHub"
        >
          <span className="sm:hidden">Source</span>
          <span className="max-sm:hidden">tarkov-dev-svg-maps</span>
        </a>
        {separator}
        <a href={CC_BY_NC_SA_4} target="_blank" rel="noopener noreferrer license" className={linkClass}>
          CC BY-NC-SA 4.0
        </a>
      </span>
      <span className="max-sm:block">
        <span className="max-sm:hidden">{separator}</span>
        Modified: {SVG_MAP_CHANGES}
      </span>
    </p>
  );
}

export function MapStageSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div className={MAP_STAGE_CLASS} aria-busy="true">
      <div className="absolute inset-x-0 top-0 flex gap-2 p-2 sm:p-3">
        <div className={cn(overlayPanel, "h-12 w-full max-w-sm animate-pulse sm:w-80")} />
        <div className={cn(overlayPanel, "ml-auto h-10 w-10 animate-pulse sm:w-28")} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="animate-pulse text-3xs font-bold uppercase tracking-widest text-[#666]">
          {children ?? "Loading"}
        </span>
      </div>
    </div>
  );
}
