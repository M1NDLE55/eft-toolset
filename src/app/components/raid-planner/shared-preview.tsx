"use client";

import { useMemo, useState } from "react";
import { Layers, LoaderCircle } from "lucide-react";
import type { MapConfig, RaidPlan } from "@/app/lib/raid-planner/types";
import { getLayerGroups } from "@/app/lib/raid-planner/layer-options";
import { useMapDetails } from "@/app/lib/cache/raidPlanner";
import { defaultFloor, FloorSwitcher } from "./floor-switcher";
import { LazyPlanEditorCanvas } from "./lazy-canvas";

export function SharedPreview({ config, plan }: { config: MapConfig; plan: RaidPlan }) {
  const [activeFloor, setActiveFloor] = useState(() => defaultFloor(config));
  const { details, loading, error, retry } = useMapDetails(config.key);
  const hasLayers = plan.enabledLayers.length > 0;

  const layerLabels = useMemo(() => {
    if (!details) return [];
    const enabled = new Set(plan.enabledLayers);
    return getLayerGroups(details).flatMap((group) =>
      group.options
        .filter((option) => enabled.has(option.id))
        .map((option) => (group.name === "Extractions" && option.id !== "transits" ? `${option.label} extracts` : option.label))
    );
  }, [details, plan.enabledLayers]);

  return (
    <>
      <div className="relative isolate h-[min(60dvh,40rem)] min-h-72 w-full overflow-hidden border border-[#2a2a2a] bg-[#050505]">
        <LazyPlanEditorCanvas
          config={config}
          activeFloor={activeFloor}
          details={details}
          enabledLayers={plan.enabledLayers}
          plan={plan}
        />
        <div className="pointer-events-auto absolute bottom-2 left-2 z-1000 sm:bottom-3 sm:left-3">
          <FloorSwitcher config={config} activeFloor={activeFloor} onChange={setActiveFloor} />
        </div>
      </div>
      {hasLayers && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-widest text-[#888]">
          <span className="flex items-center gap-1.5 text-[#9a8866]">
            {loading ? (
              <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Layers className="h-3 w-3" aria-hidden />
            )}
            Map layers
          </span>
          {error ? (
            <>
              <span className="normal-case tracking-normal text-red-300">Map data could not be loaded.</span>
              <button
                type="button"
                onClick={retry}
                className="text-[#ccc] underline underline-offset-2 hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
              >
                Retry
              </button>
            </>
          ) : layerLabels.length > 0 ? (
            layerLabels.map((label) => (
              <span key={label} className="border border-[#2a2a2a] bg-[#090909] px-1.5 py-0.5 text-[#bbb]">
                {label}
              </span>
            ))
          ) : (
            <span>{loading ? "Loading…" : "None available for this map"}</span>
          )}
        </p>
      )}
    </>
  );
}
