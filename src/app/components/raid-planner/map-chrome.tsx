import type { ReactNode } from "react";
import type { MapConfig } from "@/app/lib/raid-planner/types";
import { cn } from "@/lib/utils";
import { overlayPanel } from "./ui";

export const MAP_STAGE_CLASS = "relative isolate h-[calc(100dvh-65px)] min-h-[22rem] w-full overflow-hidden bg-[#050505]";

export function MapAttribution({ config, className }: { config: MapConfig; className?: string }) {
  if (!config.author) return null;
  return (
    <p
      className={cn(
        "pointer-events-auto absolute z-999 bg-[#090909]/80 px-2 py-1 text-[10px] uppercase tracking-widest text-[#888]",
        className
      )}
    >
      Map by{" "}
      {config.authorLink ? (
        <a
          href={config.authorLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#9a8866] underline underline-offset-2"
        >
          {config.author}
        </a>
      ) : (
        config.author
      )}
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
        <span className="animate-pulse text-[10px] font-bold uppercase tracking-widest text-[#666]">
          {children ?? "Loading"}
        </span>
      </div>
    </div>
  );
}
