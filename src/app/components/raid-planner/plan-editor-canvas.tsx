"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import L from "leaflet";
import type { GamePoint, MapConfig, PlanTool, RaidPlan } from "@/app/lib/raid-planner/types";
import type { MapDetails } from "@/app/lib/types/raidPlanner";
import { latLngToGame } from "@/app/lib/raid-planner/coords";
import { simplifyPoints } from "@/app/lib/raid-planner/simplify";
import { buildPlanLayers } from "@/app/lib/raid-planner/plan-layers";
import { createId } from "@/app/lib/id";
import {
  MAX_DRAWINGS,
  MAX_NOTES,
  MAX_POINTS_PER_DRAWING,
  MAX_ROUTE_POINTS,
  MAX_TOTAL_DRAWING_POINTS,
} from "@/app/lib/raid-planner/limits";
import { MapCanvas } from "./map-canvas";

const PEN_TOLERANCE_METERS = 0.5;
const MIN_ARROW_METERS = 2;
const MEASURE_STYLE = {
  color: "#f0f0f0",
  weight: 2,
  opacity: 1,
  dashArray: "2 5",
  interactive: false,
} as const;

type PlanUpdater = (plan: RaidPlan) => RaidPlan;

interface PlanOverlayProps {
  plan: RaidPlan;
  tool?: PlanTool;
  color?: string;
  interactive?: boolean;
  onPlanChange?: (updater: PlanUpdater) => void;
  onSelectNote?: (id: string | null) => void;
  onLimitError?: (message: string) => void;
}

interface PlanEditorCanvasProps extends PlanOverlayProps {
  config: MapConfig;
  activeFloor: string | null;
  details: MapDetails | null;
  enabledLayers: string[];
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
  ...overlay
}: PlanEditorCanvasProps) {
  return (
    <MapCanvas config={config} activeFloor={activeFloor} details={details} enabledLayers={enabledLayers}>
      {(map) => <PlanOverlay map={map} {...overlay} />}
    </MapCanvas>
  );
}

function PlanOverlay({
  map,
  plan,
  tool = "select",
  color = "#c8b384",
  interactive = false,
  onPlanChange,
  onSelectNote,
  onLimitError,
}: PlanOverlayProps & { map: L.Map }) {
  const measureRef = useRef<Measurement>({ start: null, line: null, label: null });

  const current = useEffectEvent(() => ({ tool, color, plan }));
  const change = useEffectEvent((updater: PlanUpdater) => onPlanChange?.(updater));
  const selectNote = useEffectEvent((id: string | null) => onSelectNote?.(id));
  const reportLimit = useEffectEvent((message: string) => onLimitError?.(message));

  useEffect(() => {
    if (!interactive) return;
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
    const measurement = measureRef.current;
    return () => {
      clearMeasurement(map, measurement);
      container.classList.remove("rp-touch-draw", "rp-cursor-crosshair", "rp-cursor-eraser");
    };
  }, [map, tool, interactive]);

  useEffect(() => {
    if (!interactive) return;
    const container = map.getContainer();
    const measurement = measureRef.current;

    let pointerId: number | null = null;
    let stroke: L.LatLng[] | null = null;
    let arrowStart: L.LatLng | null = null;
    let tempLine: L.Polyline | null = null;

    const toLatLng = (event: PointerEvent) => map.mouseEventToLatLng(event);

    const reset = () => {
      tempLine?.remove();
      tempLine = null;
      stroke = null;
      arrowStart = null;
      pointerId = null;
    };

    const addDrawing = (kind: "pen" | "arrow", points: GamePoint[]) => {
      const { plan: latest, color: drawingColor } = current();
      const totalPoints = latest.drawings.reduce((total, entry) => total + entry.points.length, 0);
      if (
        points.length > MAX_POINTS_PER_DRAWING ||
        latest.drawings.length >= MAX_DRAWINGS ||
        totalPoints + points.length > MAX_TOTAL_DRAWING_POINTS
      ) {
        reportLimit("This plan has reached its drawing limit.");
        return;
      }
      change((plan) => ({
        ...plan,
        drawings: [...plan.drawings, { id: createId(), kind, color: drawingColor, points }],
      }));
    };

    const finish = (end: L.LatLng) => {
      if (stroke) {
        const points = simplifyPoints(stroke.map(latLngToGame), PEN_TOLERANCE_METERS);
        if (points.length >= 2) addDrawing("pen", points);
      } else if (arrowStart) {
        const from = latLngToGame(arrowStart);
        const to = latLngToGame(end);
        if (Math.hypot(to.x - from.x, to.z - from.z) >= MIN_ARROW_METERS) addDrawing("arrow", [from, to]);
      }
      reset();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const { tool: activeTool, color: drawingColor } = current();
      if (activeTool !== "pen" && activeTool !== "arrow") return;
      if (event.target instanceof Element && event.target.closest(".leaflet-marker-icon, .leaflet-control")) {
        return;
      }
      if (pointerId !== null) {
        reset();
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      pointerId = event.pointerId;
      const latlng = toLatLng(event);
      if (activeTool === "pen") {
        stroke = [latlng];
        tempLine = L.polyline([latlng], { color: drawingColor, weight: 3, opacity: 1, interactive: false }).addTo(map);
      } else {
        arrowStart = latlng;
        tempLine = L.polyline([latlng, latlng], {
          color: drawingColor,
          weight: 3,
          opacity: 1,
          dashArray: "4 4",
          interactive: false,
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
      if (event.pointerId === pointerId) finish(toLatLng(event));
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) reset();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      reset();
      clearMeasurement(map, measurement);
    };

    const handleClick = (event: L.LeafletMouseEvent) => {
      const { tool: activeTool, color: noteColor, plan: latest } = current();
      if (activeTool === "route") {
        if (latest.route.length >= MAX_ROUTE_POINTS) {
          reportLimit("This plan has reached its route-point limit.");
          return;
        }
        const position = latLngToGame(event.latlng);
        change((plan) => ({ ...plan, route: [...plan.route, { id: createId(), position }] }));
      } else if (activeTool === "note") {
        if (latest.notes.length >= MAX_NOTES) {
          reportLimit("This plan has reached its note limit.");
          return;
        }
        const position = latLngToGame(event.latlng);
        const id = createId();
        change((plan) => ({
          ...plan,
          notes: [...plan.notes, { id, position, title: "", body: "", color: noteColor }],
        }));
        selectNote(id);
      } else if (activeTool === "measure") {
        handleMeasureClick(map, measurement, event.latlng);
      } else if (activeTool === "select") {
        selectNote(null);
      }
    };

    const handleMapMouseMove = (event: L.LeafletMouseEvent) => {
      if (current().tool === "measure") updateMeasurement(measurement, event.latlng);
    };

    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);
    map.on("click", handleClick);
    map.on("mousemove", handleMapMouseMove);

    return () => {
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      map.off("click", handleClick);
      map.off("mousemove", handleMapMouseMove);
      reset();
    };
  }, [map, interactive]);

  useEffect(() => {
    const group = buildPlanLayers(map, plan, {
      editable: interactive,
      onWaypointClick: (id) => {
        if (current().tool !== "eraser") return;
        change((latest) => ({ ...latest, route: latest.route.filter((waypoint) => waypoint.id !== id) }));
      },
      onDrawingClick: (id) => {
        if (current().tool !== "eraser") return;
        change((latest) => ({
          ...latest,
          drawings: latest.drawings.filter((drawing) => drawing.id !== id),
        }));
      },
      onNoteClick: (id) => {
        if (current().tool !== "eraser") {
          selectNote(id);
          return;
        }
        selectNote(null);
        change((latest) => ({ ...latest, notes: latest.notes.filter((note) => note.id !== id) }));
      },
      onWaypointMove: (id, position) => {
        change((latest) => ({
          ...latest,
          route: latest.route.map((waypoint) => (waypoint.id === id ? { ...waypoint, position } : waypoint)),
        }));
      },
      onNoteMove: (id, position) => {
        change((latest) => ({
          ...latest,
          notes: latest.notes.map((note) => (note.id === id ? { ...note, position } : note)),
        }));
      },
    }).addTo(map);
    return () => {
      group.remove();
    };
  }, [map, plan, interactive]);

  return null;
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

function handleMeasureClick(map: L.Map, measurement: Measurement, latlng: L.LatLng) {
  if (measurement.start) {
    updateMeasurement(measurement, latlng);
    measurement.start = null;
    return;
  }
  clearMeasurement(map, measurement);
  measurement.start = latlng;
  measurement.line = L.polyline([latlng, latlng], MEASURE_STYLE).addTo(map);
  measurement.label = L.marker(latlng, {
    interactive: false,
    keyboard: false,
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
  label.setLatLng(L.latLng((start.lat + latlng.lat) / 2, (start.lng + latlng.lng) / 2));
  const element = label.getElement()?.querySelector(".rp-measure-label");
  if (element) element.textContent = measureText(start, latlng);
}
