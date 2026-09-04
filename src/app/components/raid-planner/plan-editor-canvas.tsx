"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { MapConfig, PlanTool, RaidPlan } from "@/app/lib/raid-planner/types";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { latLngToGame } from "@/app/lib/raid-planner/coords";
import { simplifyPoints } from "@/app/lib/raid-planner/simplify";
import { buildPlanLayers } from "@/app/lib/raid-planner/plan-layers";
import { MapCanvas } from "./map-canvas";
import { createId } from "@/app/lib/id";
import {
  MAX_DRAWINGS,
  MAX_NOTES,
  MAX_POINTS_PER_DRAWING,
  MAX_ROUTE_POINTS,
  MAX_TOTAL_DRAWING_POINTS,
} from "@/app/lib/raid-planner/limits";

const PEN_TOLERANCE_METERS = 0.5;
const MIN_ARROW_METERS = 2;
const MEASURE_STYLE = {
  color: "#f0f0f0",
  weight: 2,
  opacity: 1,
  dashArray: "2 5",
  interactive: false,
} as const;

interface PlanEditorCanvasProps {
  config: MapConfig;
  activeFloor: string | null;
  details: MapDetails | null;
  enabledLayers: string[];
  plan: RaidPlan;
  tool: PlanTool;
  color: string;
  /** false renders the plan read-only (share preview): no tools, no dragging. */
  interactive?: boolean;
  onPlanChange: (updater: (plan: RaidPlan) => RaidPlan) => void;
  onSelectNote: (id: string | null) => void;
  onLimitError?: (message: string) => void;
}

interface Measurement {
  start: L.LatLng | null;
  line: L.Polyline | null;
  label: L.Marker | null;
}

export function PlanEditorCanvas({
  config,
  activeFloor,
  details,
  enabledLayers,
  plan,
  tool,
  color,
  interactive = true,
  onPlanChange,
  onSelectNote,
  onLimitError,
}: PlanEditorCanvasProps) {
  const [map, setMap] = useState<L.Map | null>(null);
  const planGroupRef = useRef<L.LayerGroup | null>(null);
  const measureRef = useRef<Measurement>({ start: null, line: null, label: null });

  // Live refs so leaflet handlers (bound once) always see current values.
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const onPlanChangeRef = useRef(onPlanChange);
  onPlanChangeRef.current = onPlanChange;
  const onSelectNoteRef = useRef(onSelectNote);
  const onLimitErrorRef = useRef(onLimitError);
  const planRef = useRef(plan);
  onSelectNoteRef.current = onSelectNote;
  onLimitErrorRef.current = onLimitError;
  planRef.current = plan;

  // Tool-dependent map behavior: freehand tools own the pointer.
  useEffect(() => {
    if (!map || !interactive) return;
    const container = map.getContainer();
    const drawing = tool === "pen" || tool === "arrow";

    if (drawing) map.dragging.disable();
    else map.dragging.enable();

    container.classList.toggle("rp-touch-draw", drawing);
    container.classList.toggle(
      "rp-cursor-crosshair",
      drawing || tool === "route" || tool === "note" || tool === "measure"
    );
    container.classList.toggle("rp-cursor-eraser", tool === "eraser");

    if (tool !== "measure") clearMeasurement(map, measureRef.current);

    return () => {
      container.classList.remove(
        "rp-touch-draw",
        "rp-cursor-crosshair",
        "rp-cursor-eraser"
      );
    };
  }, [map, tool, interactive]);

  // Freehand sketching via pointer events so mouse and touch behave alike.
  useEffect(() => {
    if (!map || !interactive) return;
    const container = map.getContainer();

    let pointerId: number | null = null;
    let stroke: L.LatLng[] | null = null;
    let arrowStart: L.LatLng | null = null;
    let tempLine: L.Polyline | null = null;

    const toLatLng = (event: PointerEvent) =>
      map.mouseEventToLatLng(event as unknown as MouseEvent);

    const clearTemp = () => {
      tempLine?.removeFrom(map);
      tempLine = null;
      stroke = null;
      arrowStart = null;
      pointerId = null;
    };

    const commitPen = () => {
      if (!stroke) return clearTemp();
      const points = simplifyPoints(
        stroke.map((latlng) => latLngToGame(latlng)),
        PEN_TOLERANCE_METERS
      );
      if (points.length >= 2) {
        const currentPlan = planRef.current;
        const totalPoints = currentPlan.drawings.reduce(
          (total, drawing) => total + drawing.points.length,
          0
        );
        if (
          points.length > MAX_POINTS_PER_DRAWING ||
          currentPlan.drawings.length >= MAX_DRAWINGS ||
          totalPoints + points.length > MAX_TOTAL_DRAWING_POINTS
        ) {
          onLimitErrorRef.current?.("This plan has reached its drawing limit.");
          return clearTemp();
        }
        const drawingColor = colorRef.current;
        onPlanChangeRef.current((current) => ({
          ...current,
          drawings: [
            ...current.drawings,
            { id: createId(), kind: "pen", color: drawingColor, points },
          ],
        }));
      }
      clearTemp();
    };

    const commitArrow = (end: L.LatLng) => {
      if (!arrowStart) return clearTemp();
      const from = latLngToGame(arrowStart);
      const to = latLngToGame(end);
      if (Math.hypot(to.x - from.x, to.z - from.z) >= MIN_ARROW_METERS) {
        const currentPlan = planRef.current;
        const totalPoints = currentPlan.drawings.reduce(
          (total, drawing) => total + drawing.points.length,
          0
        );
        if (
          currentPlan.drawings.length >= MAX_DRAWINGS ||
          totalPoints + 2 > MAX_TOTAL_DRAWING_POINTS
        ) {
          onLimitErrorRef.current?.("This plan has reached its drawing limit.");
          return clearTemp();
        }
        const drawingColor = colorRef.current;
        onPlanChangeRef.current((current) => ({
          ...current,
          drawings: [
            ...current.drawings,
            {
              id: createId(),
              kind: "arrow",
              color: drawingColor,
              points: [from, to],
            },
          ],
        }));
      }
      clearTemp();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const activeTool = toolRef.current;
      if (activeTool !== "pen" && activeTool !== "arrow") return;
      if (
        event.target instanceof Element &&
        event.target.closest(".leaflet-marker-icon")
      ) {
        return; // marker drags win over sketching
      }
      if (pointerId !== null) {
        // A second finger means a pinch gesture, not a stroke.
        clearTemp();
        return;
      }

      event.preventDefault();
      pointerId = event.pointerId;
      const latlng = toLatLng(event);

      if (activeTool === "pen") {
        stroke = [latlng];
        tempLine = L.polyline([latlng], {
          color: colorRef.current,
          weight: 3,
          opacity: 1,
        }).addTo(map);
      } else {
        arrowStart = latlng;
        tempLine = L.polyline([latlng, latlng], {
          color: colorRef.current,
          weight: 3,
          opacity: 1,
          dashArray: "4 4",
        }).addTo(map);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId || !tempLine) return;
      const latlng = toLatLng(event);
      if (stroke) {
        stroke.push(latlng);
        tempLine.addLatLng(latlng);
      } else if (arrowStart) {
        tempLine.setLatLngs([arrowStart, latlng]);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (stroke) commitPen();
      else if (arrowStart) commitArrow(toLatLng(event));
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) clearTemp();
    };

    // Clicks stay on the leaflet map so taps work like clicks.
    const handleClick = (event: L.LeafletMouseEvent) => {
      const activeTool = toolRef.current;
      if (activeTool === "route") {
        if (planRef.current.route.length >= MAX_ROUTE_POINTS) {
          onLimitErrorRef.current?.("This plan has reached its route-point limit.");
          return;
        }
        const position = latLngToGame(event.latlng);
        onPlanChangeRef.current((current) => ({
          ...current,
          route: [...current.route, { id: createId(), position }],
        }));
      } else if (activeTool === "note") {
        if (planRef.current.notes.length >= MAX_NOTES) {
          onLimitErrorRef.current?.("This plan has reached its note limit.");
          return;
        }
        const position = latLngToGame(event.latlng);
        const id = createId();
        const noteColor = colorRef.current;
        onPlanChangeRef.current((current) => ({
          ...current,
          notes: [
            ...current.notes,
            { id, position, title: "", body: "", color: noteColor },
          ],
        }));
        onSelectNoteRef.current(id);
      } else if (activeTool === "measure") {
        handleMeasureClick(map, measureRef.current, event.latlng);
      } else if (activeTool === "select") {
        onSelectNoteRef.current(null);
      }
    };

    const handleMapMouseMove = (event: L.LeafletMouseEvent) => {
      if (toolRef.current === "measure") {
        updateMeasurement(measureRef.current, event.latlng);
      }
    };

    container.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    container.addEventListener("pointercancel", handlePointerCancel);
    map.on("click", handleClick);
    map.on("mousemove", handleMapMouseMove);

    return () => {
      container.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointercancel", handlePointerCancel);
      map.off("click", handleClick);
      map.off("mousemove", handleMapMouseMove);
      clearTemp();
    };
  }, [map, interactive]);

  // Sync plan geometry.
  useEffect(() => {
    if (!map) return;

    planGroupRef.current?.removeFrom(map);
    planGroupRef.current = buildPlanLayers(map, plan, {
      draggable: interactive,
      onWaypointClick: (id) => {
        if (toolRef.current !== "eraser") return;
        onPlanChangeRef.current((current) => ({
          ...current,
          route: current.route.filter((waypoint) => waypoint.id !== id),
        }));
      },
      onDrawingClick: (id) => {
        if (toolRef.current !== "eraser") return;
        onPlanChangeRef.current((current) => ({
          ...current,
          drawings: current.drawings.filter((drawing) => drawing.id !== id),
        }));
      },
      onNoteClick: (id) => {
        if (toolRef.current === "eraser") {
          onSelectNoteRef.current(null);
          onPlanChangeRef.current((current) => ({
            ...current,
            notes: current.notes.filter((note) => note.id !== id),
          }));
        } else {
          onSelectNoteRef.current(id);
        }
      },
      onWaypointMove: (id, position) => {
        onPlanChangeRef.current((current) => ({
          ...current,
          route: current.route.map((waypoint) =>
            waypoint.id === id ? { ...waypoint, position } : waypoint
          ),
        }));
      },
      onNoteMove: (id, position) => {
        onPlanChangeRef.current((current) => ({
          ...current,
          notes: current.notes.map((note) =>
            note.id === id ? { ...note, position } : note
          ),
        }));
      },
    });
    planGroupRef.current.addTo(map);

    return () => {
      planGroupRef.current?.removeFrom(map);
      planGroupRef.current = null;
    };
  }, [map, plan, interactive]);

  return (
    <MapCanvas
      config={config}
      activeFloor={activeFloor}
      details={details}
      enabledLayers={enabledLayers}
      onReady={setMap}
    />
  );
}

function measureText(from: L.LatLng, to: L.LatLng) {
  const a = latLngToGame(from);
  const b = latLngToGame(to);
  return `${Math.round(Math.hypot(b.x - a.x, b.z - a.z))} m`;
}

function clearMeasurement(map: L.Map, measurement: Measurement) {
  measurement.line?.removeFrom(map);
  measurement.label?.removeFrom(map);
  measurement.start = null;
  measurement.line = null;
  measurement.label = null;
}

function handleMeasureClick(
  map: L.Map,
  measurement: Measurement,
  latlng: L.LatLng
) {
  if (measurement.start) {
    // Second click freezes the measurement until the next one starts.
    updateMeasurement(measurement, latlng);
    measurement.start = null;
    return;
  }

  clearMeasurement(map, measurement);
  measurement.start = latlng;
  measurement.line = L.polyline([latlng, latlng], MEASURE_STYLE).addTo(map);
  measurement.label = L.marker(latlng, {
    interactive: false,
    icon: L.divIcon({
      className: "rp-glyph-wrap",
      html: `<div class="rp-measure-label">0 m</div>`,
      iconSize: [0, 0],
    }),
  }).addTo(map);
}

function updateMeasurement(measurement: Measurement, latlng: L.LatLng) {
  const { start, line, label } = measurement;
  if (!start || !line || !label) return;

  line.setLatLngs([start, latlng]);
  label.setLatLng(
    L.latLng((start.lat + latlng.lat) / 2, (start.lng + latlng.lng) / 2)
  );
  const el = label.getElement()?.querySelector(".rp-measure-label");
  if (el) el.textContent = measureText(start, latlng);
}
