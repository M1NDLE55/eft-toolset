"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapConfig } from "@/app/lib/raid-planner/types";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { getMapBounds, getMapCRS, getScaledBounds } from "@/app/lib/raid-planner/coords";
import {
  applyFloorDimming,
  buildLayer,
  getActiveExtents,
  type LayerEntry,
} from "@/app/lib/raid-planner/layers";
import { fillMapSvg } from "@/app/lib/raid-planner/map-svg";
import { cn } from "@/lib/utils";

const SVG_NS = "http://www.w3.org/2000/svg";
const BASE_SVG_CLASS = "rp-base-svg";
const HIDDEN_GROUP_CLASS = "rp-hidden";
const DIMMED_GROUP_CLASS = "rp-dimmed";
const OFF_LEVEL_CLASS = "rp-off-level";

interface MapCanvasProps {
  config: MapConfig;
  activeFloor: string | null;
  details: MapDetails | null;
  enabledLayers: string[];
  className?: string;
  children?: (map: L.Map) => ReactNode;
}

interface BaseMap {
  map: L.Map;
  tiles?: L.TileLayer;
  svg?: SVGSVGElement;
}

interface LayerCache {
  map: L.Map;
  details: MapDetails | null;
  renderer: L.Canvas;
  entries: Map<string, LayerEntry>;
}

export function MapCanvas({
  config,
  activeFloor,
  details,
  enabledLayers,
  className,
  children,
}: MapCanvasProps) {
  const [base, setBase] = useState<BaseMap | null>(null);
  const [baseReady, setBaseReady] = useState(false);
  const [baseError, setBaseError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const layerCache = useRef<LayerCache | null>(null);

  const containerRef = useCallback(
    (container: HTMLDivElement | null) => {
      if (!container) return;
      const bounds = getMapBounds(config.bounds);
      const maxZoom = Math.max(7, config.maxZoom);
      const map = L.map(container, {
        crs: getMapCRS(config),
        attributionControl: false,
        zoomControl: false,
        zoomSnap: 0.1,
        wheelPxPerZoomLevel: 120,
        minZoom: config.minZoom,
        maxZoom,
        maxBounds: getScaledBounds(config.bounds, 1.5),
        maxBoundsViscosity: 0.8,
      });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      map.fitBounds(bounds, { paddingTopLeft: [16, 56], paddingBottomRight: [16, 16] });

      let cancelled = false;
      const next: BaseMap = { map };
      if (config.strategy === "tile" && config.tilePath) {
        next.tiles = L.tileLayer(config.tilePath, {
          tileSize: config.tileSize,
          bounds,
          maxNativeZoom: config.maxZoom,
          maxZoom,
          keepBuffer: 4,
        }).addTo(map);
        watchTiles(next.tiles, () => setBaseReady(true), () => setBaseError("The map tiles could not be loaded."));
      } else if (config.svgPath) {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("data-rp-map", "");
        next.svg = svg;
        L.svgOverlay(svg, config.svgBounds ? getMapBounds(config.svgBounds) : bounds, {
          className: BASE_SVG_CLASS,
        }).addTo(map);
        fillMapSvg(svg, config.svgPath).then(
          () => {
            if (!cancelled) setBaseReady(true);
          },
          (reason: unknown) => {
            if (!cancelled) setBaseError(errorMessage(reason));
          }
        );
      }

      setBase(next);
      return () => {
        cancelled = true;
        layerCache.current = null;
        map.remove();
        setBase(null);
        setBaseReady(false);
        setBaseError("");
      };
    },
    [config]
  );

  useEffect(() => {
    if (!base) return;
    if (base.svg) {
      if (baseReady) applySvgFloor(base.svg, config, activeFloor);
      return;
    }
    const floor = config.floors.find((candidate) => candidate.id === activeFloor);
    const baseContainer = base.tiles?.getContainer();
    if (!floor?.tilePath) return;
    const overlay = L.tileLayer(floor.tilePath, {
      tileSize: config.tileSize,
      bounds: getMapBounds(config.bounds),
      maxNativeZoom: config.maxZoom,
      maxZoom: Math.max(7, config.maxZoom),
    }).addTo(base.map);
    watchTiles(overlay, () => undefined, () => setBaseError("The floor tiles could not be loaded."));
    baseContainer?.classList.add(OFF_LEVEL_CLASS);
    return () => {
      overlay.remove();
      baseContainer?.classList.remove(OFF_LEVEL_CLASS);
    };
  }, [base, baseReady, config, activeFloor, retryCount]);

  useEffect(() => {
    if (!base) return;
    const { map } = base;
    let cache = layerCache.current;
    if (!cache || cache.map !== map) {
      cache = { map, details, renderer: L.canvas({ padding: 0.5 }), entries: new Map() };
      layerCache.current = cache;
    } else if (cache.details !== details) {
      cache.entries.forEach((entry) => entry.group.remove());
      cache.entries.clear();
      cache.details = details;
    }
    if (!details) return;

    const enabled = new Set(enabledLayers);
    cache.entries.forEach((entry, id) => {
      if (!enabled.has(id)) entry.group.remove();
    });
    const extents = getActiveExtents(config, activeFloor);
    for (const id of enabled) {
      let entry = cache.entries.get(id);
      if (!entry) {
        const built = buildLayer(id, { details, renderer: cache.renderer });
        if (!built) continue;
        cache.entries.set(id, built);
        entry = built;
      }
      if (!map.hasLayer(entry.group)) entry.group.addTo(map);
      applyFloorDimming(entry, extents);
    }
  }, [base, config, details, enabledLayers, activeFloor]);

  function retry() {
    if (!base) return;
    setBaseError("");
    setRetryCount((count) => count + 1);
    if (base.tiles) {
      base.tiles.redraw();
    } else if (base.svg && config.svgPath) {
      fillMapSvg(base.svg, config.svgPath).then(
        () => setBaseReady(true),
        (reason: unknown) => setBaseError(errorMessage(reason))
      );
    }
  }

  return (
    <div className={cn("relative h-full w-full bg-[#050505]", className)}>
      <div
        ref={containerRef}
        className="rp-map h-full w-full"
        role="region"
        aria-label={`${config.name} interactive map`}
        aria-busy={!baseReady}
      />
      {!baseReady && !baseError && (
        <div className="pointer-events-none absolute inset-0 z-500 flex items-center justify-center">
          <span className="animate-pulse text-[10px] font-bold uppercase tracking-widest text-[#666]">
            Loading {config.name}
          </span>
        </div>
      )}
      {baseError && (
        <div
          role="alert"
          className="absolute bottom-20 left-1/2 z-1001 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-3 border border-red-900/60 bg-[#090909]/95 py-1 pl-3 pr-1 text-xs text-red-200 sm:bottom-3"
        >
          <span className="min-w-0">{baseError}</span>
          <button
            type="button"
            className="h-9 shrink-0 px-3 text-[10px] font-bold uppercase tracking-widest text-[#ccc] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#9a8866]"
            onClick={retry}
          >
            Retry
          </button>
        </div>
      )}
      {base && children?.(base.map)}
    </div>
  );
}

function watchTiles(layer: L.TileLayer, onReady: () => void, onFail: () => void) {
  let loaded = 0;
  layer.on("tileload", () => {
    loaded += 1;
  });
  layer.on("load", () => {
    onReady();
    if (loaded === 0) onFail();
  });
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "The map image could not be loaded.";
}

function applySvgFloor(svgElement: SVGSVGElement, config: MapConfig, activeFloor: string | null) {
  const inner = svgElement.children[0];
  if (!inner) return;
  const activeGroupId = config.floors.find((floor) => floor.id === activeFloor)?.svgLayer;

  for (const child of Array.from(inner.children)) {
    if (child.nodeName !== "g" || !child.id) continue;
    const isBase =
      child.id === config.svgLayer ||
      (child as SVGGElement).dataset["keepWithGroup"] === config.svgLayer;

    if (isBase) {
      child.classList.remove(HIDDEN_GROUP_CLASS);
      child.classList.toggle(DIMMED_GROUP_CLASS, Boolean(activeGroupId));
    } else if (activeGroupId && child.id === activeGroupId) {
      child.classList.remove(HIDDEN_GROUP_CLASS, DIMMED_GROUP_CLASS);
    } else {
      child.classList.add(HIDDEN_GROUP_CLASS);
      child.classList.remove(DIMMED_GROUP_CLASS);
    }
  }
}
