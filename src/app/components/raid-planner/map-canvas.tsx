"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapConfig } from "@/app/lib/raid-planner/types";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import {
  getMapBounds,
  getMapCRS,
  getScaledBounds,
} from "@/app/lib/raid-planner/coords";
import {
  applyFloorDimming,
  buildLayer,
  getActiveExtents,
  type LayerEntry,
} from "@/app/lib/raid-planner/layers";
import { parseSafeSvg } from "@/app/lib/raid-planner/sanitize-svg";

const BASE_SVG_CLASS = "rp-base-svg";
const HIDDEN_GROUP_CLASS = "rp-hidden";
const DIMMED_GROUP_CLASS = "rp-dimmed";
const OFF_LEVEL_CLASS = "rp-off-level";
const MAX_MAP_SVG_BYTES = 8 * 1024 * 1024;

interface MapCanvasProps {
  config: MapConfig;
  /** Floor id from config.floors, or null for ground level. */
  activeFloor: string | null;
  details: MapDetails | null;
  enabledLayers: string[];
  onReady?: (map: L.Map) => void;
}

export function MapCanvas({
  config,
  activeFloor,
  details,
  enabledLayers,
  onReady,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const svgElementRef = useRef<SVGSVGElement | null>(null);
  const baseLayerRef = useRef<L.TileLayer | L.SVGOverlay | null>(null);
  const floorTileRef = useRef<L.TileLayer | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  const entriesRef = useRef<Map<string, LayerEntry>>(new Map());
  const entriesDetailsRef = useRef<MapDetails | null>(null);
  const activeFloorRef = useRef(activeFloor);
  const [baseMapError, setBaseMapError] = useState("");
  const [baseRetry, setBaseRetry] = useState(0);
  activeFloorRef.current = activeFloor;

  // Create the map once per map config.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setBaseMapError("");

    const bounds = getMapBounds(config.bounds);
    const maxZoom = Math.max(7, config.maxZoom);

    const map = L.map(container, {
      crs: getMapCRS(config),
      attributionControl: false,
      zoomControl: false,
      zoomSnap: 0.1,
      wheelPxPerZoomLevel: 120,
      scrollWheelZoom: true,
      minZoom: config.minZoom,
      maxZoom,
      maxBounds: getScaledBounds(config.bounds, 1.5),
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    if (config.strategy === "tile" && config.tilePath) {
      baseLayerRef.current = L.tileLayer(config.tilePath, {
        tileSize: config.tileSize,
        bounds,
        maxNativeZoom: config.maxZoom,
        maxZoom,
      })
        .on("tileerror", () => setBaseMapError("Some map tiles could not be loaded."))
        .addTo(map);
    } else if (config.svgPath) {
      const svgElement = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
      );
      svgElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svgElement.setAttribute("data-rp-map", "");
      svgElementRef.current = svgElement;

      const svgBounds = config.svgBounds
        ? getMapBounds(config.svgBounds)
        : bounds;
      baseLayerRef.current = L.svgOverlay(svgElement, svgBounds, {
        className: BASE_SVG_CLASS,
      }).addTo(map);

      const controller = new AbortController();
      fetch(config.svgPath, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`Map SVG request failed (${response.status}).`);
          return readTextWithLimit(response, MAX_MAP_SVG_BYTES);
        })
        .then((svgText) => {
          const safeSvg = parseSafeSvg(svgText);
          const viewBox = safeSvg.getAttribute("viewBox");
          if (viewBox) svgElement.setAttribute("viewBox", viewBox);
          svgElement.replaceChildren(
            ...Array.from(safeSvg.childNodes).map((node) => document.importNode(node, true))
          );
          applySvgFloor(svgElement, config, activeFloorRef.current);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setBaseMapError(
            error instanceof Error ? error.message : "The map image could not be loaded."
          );
        });
      baseLayerRef.current.once("remove", () => controller.abort());
    }

    map.fitBounds(bounds);
    mapRef.current = map;
    onReady?.(map);

    return () => {
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      floorTileRef.current = null;
      svgElementRef.current = null;
      rendererRef.current = null;
      entriesRef.current = new Map();
      entriesDetailsRef.current = null;
    };
    // The canvas is remounted via `key` when the map changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRetry, config]);

  // Apply floor changes to the base imagery.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (config.strategy === "tile") {
      floorTileRef.current?.removeFrom(map);
      floorTileRef.current = null;

      const baseContainer = (baseLayerRef.current as L.TileLayer | null)
        ?.getContainer?.();
      const floor = config.floors.find((f) => f.id === activeFloor);

      if (floor?.tilePath) {
        floorTileRef.current = L.tileLayer(floor.tilePath, {
          tileSize: config.tileSize,
          bounds: getMapBounds(config.bounds),
          maxNativeZoom: config.maxZoom,
          maxZoom: Math.max(7, config.maxZoom),
        })
          .on("tileerror", () => setBaseMapError("Some floor tiles could not be loaded."))
          .addTo(map);
        baseContainer?.classList.add(OFF_LEVEL_CLASS);
      } else {
        baseContainer?.classList.remove(OFF_LEVEL_CLASS);
      }
    } else if (svgElementRef.current) {
      applySvgFloor(svgElementRef.current, config, activeFloor);
    }
  }, [config, activeFloor]);

  // Sync data layers with the enabled set and dim markers off the active floor.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const entries = entriesRef.current;

    // Drop layers built from stale details (map data or game mode changed).
    if (entriesDetailsRef.current !== details) {
      entries.forEach((entry) => entry.group.removeFrom(map));
      entries.clear();
      entriesDetailsRef.current = details;
    }
    if (!details) return;

    if (!rendererRef.current) {
      rendererRef.current = L.canvas({ padding: 0.5 });
    }

    const enabled = new Set(enabledLayers);
    entries.forEach((entry, id) => {
      if (!enabled.has(id)) entry.group.removeFrom(map);
    });

    const renderer = rendererRef.current;
    const extents = getActiveExtents(config, activeFloor);
    enabled.forEach((id) => {
      let entry = entries.get(id);
      if (!entry) {
        const built = buildLayer(id, { details, renderer });
        if (!built) return;
        entries.set(id, built);
        entry = built;
      }
      if (!map.hasLayer(entry.group)) entry.group.addTo(map);
      // After the group is on the map so marker elements exist.
      applyFloorDimming(entry, extents);
    });
  }, [config, details, enabledLayers, activeFloor]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="rp-map h-full w-full"
        role="region"
        aria-label={`${config.name} interactive map`}
      />
      {baseMapError && (
        <div role="alert" className="absolute bottom-3 left-1/2 z-[1001] flex -translate-x-1/2 items-center gap-2 border border-red-900/60 bg-[#090909]/95 px-3 py-2 text-xs text-red-200">
          <span>{baseMapError}</span>
          <button type="button" className="underline underline-offset-2" onClick={() => setBaseRetry((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("The map image is too large.");
  }
  if (!response.body) throw new Error("The map image response was empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("Map image exceeded its size limit.");
        throw new Error("The map image is too large.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

/**
 * Show the requested floor's SVG group, dim the ground group while a floor is
 * active, and hide all other floor groups. Groups marked to travel with the
 * ground level (data-keep-with-group) stay visible with it.
 */
function applySvgFloor(
  svgElement: SVGSVGElement,
  config: MapConfig,
  activeFloor: string | null
) {
  const inner = svgElement.children[0];
  if (!inner) return;

  const activeGroupId = config.floors.find((f) => f.id === activeFloor)
    ?.svgLayer;

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
