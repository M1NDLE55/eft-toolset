"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { createPlan } from "@/app/lib/raid-planner/store";
import { getLayerGroups } from "@/app/lib/raid-planner/layer-options";
import { useStoredLayers, writeStoredLayers } from "@/app/lib/raid-planner/layer-store";
import { MAX_LAYERS } from "@/app/lib/raid-planner/limits";
import { useMapDetails } from "@/app/lib/cache/raidPlanner";
import { cn } from "@/lib/utils";
import { defaultFloor, FloorSwitcher } from "./floor-switcher";
import { LayerPanel } from "./layer-panel";
import { LazyMapCanvas } from "./lazy-canvas";
import { MAP_STAGE_CLASS, MapAttribution } from "./map-chrome";
import { focusRing, iconButton, overlayPanel } from "./ui";

export function MapViewer({ mapKey }: { mapKey: string }) {
  const config = getMapConfig(mapKey)!;
  const router = useRouter();
  const [activeFloor, setActiveFloor] = useState(() => defaultFloor(config));
  const [actionError, setActionError] = useState("");
  const { details, loading, error, retry } = useMapDetails(config.key);
  const enabledLayers = useStoredLayers(config.key);
  const enabledSet = useMemo(() => new Set(enabledLayers), [enabledLayers]);
  const layerGroups = useMemo(() => (details ? getLayerGroups(details) : null), [details]);

  function changeLayers(ids: string[], checked: boolean) {
    const next = new Set(enabledLayers);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    if (next.size > MAX_LAYERS) {
      setActionError(`A map can enable at most ${MAX_LAYERS} layers.`);
      return;
    }
    try {
      writeStoredLayers(config.key, Array.from(next));
      setActionError("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not save layer settings.");
    }
  }

  function startPlan() {
    try {
      const plan = createPlan(`${config.name} raid`, config.key);
      router.push(`/raid-planner/${plan.id}`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not create this plan.");
    }
  }

  return (
    <div className={MAP_STAGE_CLASS}>
      <LazyMapCanvas config={config} activeFloor={activeFloor} details={details} enabledLayers={enabledLayers} />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-1000 flex items-start gap-2 p-2 sm:p-3">
        <div className={cn(overlayPanel, "pointer-events-auto flex min-w-0 items-center max-sm:flex-1")}>
          <Link href="/raid-planner" className={iconButton} title="Back to raid planner">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span className="sr-only">Back to raid planner</span>
          </Link>
          <div className="min-w-0 flex-1 px-1">
            <h1 className="truncate text-xs font-bold uppercase tracking-widest text-[#c9b88d] sm:text-sm">
              {config.name}
            </h1>
            <p className="truncate text-[10px] uppercase tracking-widest text-[#888]">
              {details?.raidDuration || details?.players
                ? [details.raidDuration && `${details.raidDuration} min`, details.players && `${details.players} players`]
                    .filter(Boolean)
                    .join(" · ")
                : "Interactive map"}
            </p>
          </div>
          <button
            type="button"
            onClick={startPlan}
            className={cn(
              "ml-1 flex h-10 shrink-0 items-center gap-1.5 border-l border-[#2a2a2a] px-3 text-[10px] font-bold uppercase tracking-widest text-[#9a8866] transition-colors hover:bg-[#1a1a1a] hover:text-[#c9b88d] sm:h-9",
              focusRing
            )}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Plan
            <span className="sr-only"> a raid on {config.name}</span>
          </button>
        </div>

        <div className="pointer-events-auto ml-auto">
          <LayerPanel
            groups={layerGroups}
            enabled={enabledSet}
            onChange={changeLayers}
            loading={loading}
            error={error}
            onRetry={retry}
          />
        </div>
      </div>

      {actionError && (
        <p
          role="alert"
          className={cn(
            overlayPanel,
            "absolute bottom-14 left-1/2 z-1001 w-max max-w-[calc(100%-1rem)] -translate-x-1/2 border-red-900/60 px-3 py-2 text-xs text-red-200"
          )}
        >
          {actionError}
        </p>
      )}

      <div className="pointer-events-auto absolute bottom-2 right-2 z-1000 sm:bottom-24 sm:right-3">
        <FloorSwitcher config={config} activeFloor={activeFloor} onChange={setActiveFloor} />
      </div>

      <MapAttribution config={config} className="bottom-2 left-2 sm:bottom-3 sm:left-3" />
    </div>
  );
}
