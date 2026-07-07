// Renders a plan's route, drawings, and notes as a Leaflet layer group.
// Client-only (imports leaflet); only the editor canvas should import this.
import L from "leaflet";
import type { Drawing, GamePoint, NotePin, RaidPlan } from "./types";
import { gameToLatLng, latLngToGame } from "./coords";

const ROUTE_COLOR = "#9a8866";

export interface PlanLayerHandlers {
  /** Waypoint and note pins are draggable when this is set. */
  draggable: boolean;
  onWaypointClick: (id: string) => void;
  onDrawingClick: (id: string) => void;
  onNoteClick: (id: string) => void;
  onWaypointMove: (id: string, position: GamePoint) => void;
  onNoteMove: (id: string, position: GamePoint) => void;
}

export function buildPlanLayers(
  map: L.Map,
  plan: RaidPlan,
  handlers: PlanLayerHandlers
): L.LayerGroup {
  const group = L.layerGroup();

  if (plan.route.length > 1) {
    L.polyline(
      plan.route.map((waypoint) => gameToLatLng(waypoint.position)),
      { color: ROUTE_COLOR, weight: 2, opacity: 0.9, dashArray: "6 4" }
    ).addTo(group);
  }

  plan.route.forEach((waypoint, index) => {
    const marker = L.marker(gameToLatLng(waypoint.position), {
      draggable: handlers.draggable,
      icon: L.divIcon({
        className: "rp-glyph-wrap",
        html: `<div class="rp-waypoint">${index + 1}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    });
    marker.on("click", () => handlers.onWaypointClick(waypoint.id));
    marker.on("dragend", () =>
      handlers.onWaypointMove(waypoint.id, latLngToGame(marker.getLatLng()))
    );
    marker.addTo(group);
  });

  for (const drawing of plan.drawings) {
    const layer =
      drawing.kind === "arrow"
        ? buildArrow(map, drawing, group)
        : L.polyline(
            drawing.points.map((point) => gameToLatLng(point)),
            { color: drawing.color, weight: 3, opacity: 0.85 }
          ).addTo(group);
    layer.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      handlers.onDrawingClick(drawing.id);
    });
  }

  for (const note of plan.notes) {
    const marker = buildNoteMarker(note, handlers.draggable);
    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      handlers.onNoteClick(note.id);
    });
    marker.on("dragend", () =>
      handlers.onNoteMove(note.id, latLngToGame(marker.getLatLng()))
    );
    marker.addTo(group);
  }

  return group;
}

export function buildNoteMarker(note: NotePin, draggable = false): L.Marker {
  const marker = L.marker(gameToLatLng(note.position), {
    draggable,
    icon: L.divIcon({
      className: "rp-glyph-wrap",
      html: `<div class="rp-note-pin" style="--glyph:${note.color}"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 16],
    }),
  });
  if (note.title) {
    marker.bindTooltip(note.title, { direction: "top", offset: [0, -16] });
  }
  return marker;
}

/**
 * Arrow = polyline plus a rotated arrowhead marker at the end. The screen
 * angle is zoom-invariant (uniform CRS scaling), so it can be projected once
 * at build time.
 */
function buildArrow(
  map: L.Map,
  drawing: Drawing,
  group: L.LayerGroup
): L.Polyline {
  const from = gameToLatLng(drawing.points[0]);
  const to = gameToLatLng(drawing.points[drawing.points.length - 1]);

  const line = L.polyline([from, to], {
    color: drawing.color,
    weight: 3,
    opacity: 0.85,
  }).addTo(group);

  const fromPoint = map.project(L.latLng(from), 0);
  const toPoint = map.project(L.latLng(to), 0);
  const angle =
    (Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x) * 180) /
    Math.PI;

  L.marker(to, {
    interactive: false,
    icon: L.divIcon({
      className: "rp-glyph-wrap",
      html: `<div class="rp-arrowhead" style="--glyph:${drawing.color}; transform: rotate(${angle}deg)"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    }),
  }).addTo(group);

  return line;
}
