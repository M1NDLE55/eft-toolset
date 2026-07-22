"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { getMapConfig } from "@/app/lib/raid-planner/maps-config";
import { createPlan } from "@/app/lib/raid-planner/store";
import { getLayerGroups } from "@/app/lib/raid-planner/layer-options";
import { fetchMapDetails } from "@/app/lib/cache/raidPlanner";
import { useGameMode } from "@/components/game-mode/context";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { FloorSwitcher } from "@/app/components/raid-planner/floor-switcher";
import { LayerPanel } from "@/app/components/raid-planner/layer-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { readStoredLayers, writeStoredLayers } from "@/app/lib/raid-planner/layer-store";

const MapCanvas = dynamic(
  () =>
    import("@/app/components/raid-planner/map-canvas").then(
      (module) => module.MapCanvas
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full" />,
  }
);

export default function MapViewerPage() {
  const router = useRouter();
  const params = useParams<{ map: string }>();
  const config = getMapConfig(params.map);
  if (!config) notFound();

  const { gameMode } = useGameMode();

  const defaultFloor = useMemo(
    () => config.floors.find((floor) => floor.show)?.id ?? null,
    [config]
  );
  const [activeFloor, setActiveFloor] = useState<string | null>(defaultFloor);

  const [details, setDetails] = useState<MapDetails | null>(null);
  const [detailsError, setDetailsError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setDetailsError(false);

    fetchMapDetails(config.key, config.name, gameMode)
      .then((result) => {
        if (cancelled) return;
        setDetails(result);
        setDetailsError(!result);
      })
      .catch(() => {
        if (!cancelled) setDetailsError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [config.key, config.name, gameMode, retryToken]);

  const [enabledLayers, setEnabledLayers] = useState<Set<string>>(new Set());

  useEffect(() => {
    setEnabledLayers(readStoredLayers(config.key));
  }, [config.key]);

  const handleLayerChange = useCallback(
    (ids: string[], checked: boolean) => {
      setEnabledLayers((previous) => {
        const next = new Set(previous);
        for (const id of ids) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        writeStoredLayers(config.key, next);
        return next;
      });
    },
    [config.key]
  );

  const layerGroups = useMemo(
    () => (details ? getLayerGroups(details) : null),
    [details]
  );
  const enabledLayerList = useMemo(
    () => Array.from(enabledLayers),
    [enabledLayers]
  );

  return (
    <div className="relative h-[calc(100dvh-65px)] w-full overflow-hidden">
      <MapCanvas
        key={config.key}
        config={config}
        activeFloor={activeFloor}
        details={details}
        enabledLayers={enabledLayerList}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2 border border-[#2a2a2a] bg-[#090909]/90 px-3 py-2 backdrop-blur-sm">
          <Link
            href={{ pathname: "/raid-planner" }}
            className="text-[#777] transition-colors hover:text-[#9a8866]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to map list</span>
          </Link>
          <span className="text-sm font-bold uppercase tracking-widest text-[#9a8866]">
            {config.name}
          </span>
          <button
            type="button"
            onClick={() => {
              const plan = createPlan(`${config.name} raid`, config.key);
              router.push(`/raid-planner/${plan.id}`);
            }}
            className="flex items-center gap-1 border border-[#2a2a2a] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[#777] transition-colors hover:border-[#9a8866] hover:text-[#ccc]"
          >
            <Plus className="h-3 w-3" />
            Plan
          </button>
          {details?.players && details?.raidDuration && (
            <span className="hidden text-[10px] uppercase tracking-widest text-[#555] sm:inline">
              {details.players} players · {details.raidDuration} min
            </span>
          )}
        </div>

        <div className="pointer-events-auto">
          <LayerPanel
            groups={layerGroups}
            enabled={enabledLayers}
            onChange={handleLayerChange}
            loading={!details && !detailsError}
            error={detailsError}
            onRetry={() => setRetryToken((token) => token + 1)}
          />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 right-0 z-[1000] flex flex-col items-end gap-2 p-3 pb-24">
        <div className="pointer-events-auto">
          <FloorSwitcher
            config={config}
            activeFloor={activeFloor}
            onChange={setActiveFloor}
          />
        </div>
      </div>

      {config.author && (
        <div className="pointer-events-none absolute bottom-0 left-0 z-[1000] p-3">
          <p className="pointer-events-auto bg-[#090909]/80 px-2 py-1 text-[10px] uppercase tracking-widest text-[#555]">
            Map by{" "}
            {config.authorLink ? (
              <a
                href={config.authorLink}
                className="text-[#9a8866] underline underline-offset-2"
              >
                {config.author}
              </a>
            ) : (
              config.author
            )}
          </p>
        </div>
      )}
    </div>
  );
}
