import L from "leaflet";
import type { Drawing, GamePoint, NotePin, RaidPlan } from "./types";
import { getPlanDisplayColor, PLAN_COLORS } from "./types";
import { gameToLatLng, latLngToGame } from "./coords";
import { makeLayerAccessible } from "./leaflet-accessibility";

const ROUTE_COLOR = PLAN_COLORS[0];
const CASING_COLOR = "#050505";

/** A dark outline under a plan line, so light colours stay visible on light roads. */
function addCasing(latLngs: L.LatLngExpression[], weight: number, group: L.LayerGroup) {
  L.polyline(latLngs, {
    color: CASING_COLOR,
    weight: weight + 3,
    opacity: 0.6,
    interactive: false,
    className: "rp-plan-casing",
  }).addTo(group);
}

export interface PlanLayerHandlers {
  editable: boolean;
  onWaypointClick: (id: string) => void;
  onDrawingClick: (id: string) => void;
  onNoteClick: (id: string) => void;
  onWaypointMove: (id: string, position: GamePoint) => void;
  onNoteMove: (id: string, position: GamePoint) => void;
  /** A drag in progress (live plans show it to others). */
  onDrag?: (target: string, position: GamePoint) => void;
  /** Items others are editing, by "wp:<id>" or "note:<id>", with the colour to outline them in. */
  highlights?: ReadonlyMap<string, string>;
}

function outline(handlers: PlanLayerHandlers, target: string) {
  const color = handlers.highlights?.get(target);
  return color ? ` style="box-shadow:0 0 0 3px ${color}"` : "";
}

export function buildPlanLayers(
  map: L.Map,
  plan: RaidPlan,
  handlers: PlanLayerHandlers
): L.LayerGroup {
  const group = L.layerGroup();

  if (plan.route.length > 1) {
    const routeLatLngs = plan.route.map((waypoint) => gameToLatLng(waypoint.position));
    addCasing(routeLatLngs, 2, group);
    L.polyline(routeLatLngs, { color: ROUTE_COLOR, weight: 2, opacity: 0.95, dashArray: "6 4" }).addTo(group);
  }

  plan.route.forEach((waypoint, index) => {
    const marker = L.marker(gameToLatLng(waypoint.position), {
      draggable: handlers.editable,
      icon: L.divIcon({
        className: "rp-glyph-wrap",
        html: `<div class="rp-waypoint"${outline(handlers, `wp:${waypoint.id}`)}>${index + 1}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    });
    marker.on("click", () => handlers.onWaypointClick(waypoint.id));
    makeLayerAccessible(marker, `Waypoint ${index + 1}`, () =>
      handlers.onWaypointClick(waypoint.id)
    );
    marker.on("dragend", () =>
      handlers.onWaypointMove(waypoint.id, latLngToGame(marker.getLatLng()))
    );
    if (handlers.onDrag) marker.on("drag", () => handlers.onDrag?.(`wp:${waypoint.id}`, latLngToGame(marker.getLatLng())));
    marker.addTo(group);
  });

  for (const drawing of plan.drawings) {
    const displayColor = getPlanDisplayColor(drawing.color);
    const latLngs = drawing.points.map((point) => gameToLatLng(point));
    if (drawing.kind !== "arrow") addCasing(latLngs, 3, group);
    const layer =
      drawing.kind === "arrow"
        ? buildArrow(map, drawing, displayColor, group)
        : L.polyline(latLngs, { color: displayColor, weight: 3, opacity: 1 }).addTo(group);
    const activate = (event: L.LeafletEvent) => {
      L.DomEvent.stopPropagation(event);
      handlers.onDrawingClick(drawing.id);
    };
    layer.on("click", activate);
    if (handlers.editable) {
      L.polyline(drawing.kind === "arrow" ? [latLngs[0], latLngs[latLngs.length - 1]] : latLngs, {
        weight: 18,
        opacity: 0,
        className: "rp-hit-line",
      })
        .on("click", activate)
        .addTo(group);
    }
    makeLayerAccessible(
      layer,
      drawing.kind === "arrow" ? "Arrow drawing" : "Freehand drawing",
      () => handlers.onDrawingClick(drawing.id)
    );
  }

  for (const note of plan.notes) {
    const marker = buildNoteMarker(note, handlers.editable, handlers.highlights?.get(`note:${note.id}`));
    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      handlers.onNoteClick(note.id);
    });
    makeLayerAccessible(marker, note.title || "Plan note", () =>
      handlers.onNoteClick(note.id)
    );
    marker.on("dragend", () =>
      handlers.onNoteMove(note.id, latLngToGame(marker.getLatLng()))
    );
    if (handlers.onDrag) marker.on("drag", () => handlers.onDrag?.(`note:${note.id}`, latLngToGame(marker.getLatLng())));
    marker.addTo(group);
  }

  return group;
}

function buildNoteMarker(note: NotePin, draggable: boolean, highlight?: string): L.Marker {
  const displayColor = getPlanDisplayColor(note.color);
  const ring = highlight ? `;box-shadow:0 0 0 3px ${highlight}` : "";
  const marker = L.marker(gameToLatLng(note.position), {
    draggable,
    icon: L.divIcon({
      className: "rp-glyph-wrap",
      html: `<div class="rp-note-pin" style="--glyph:${displayColor}${ring}"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 16],
    }),
  });
  if (note.title) {
    const content = document.createElement("span");
    content.textContent = note.title;
    marker.bindTooltip(content, { direction: "top", offset: [0, -16] });
  }
  return marker;
}

function buildArrow(
  map: L.Map,
  drawing: Drawing,
  displayColor: string,
  group: L.LayerGroup
): L.Polyline {
  const from = gameToLatLng(drawing.points[0]);
  const to = gameToLatLng(drawing.points[drawing.points.length - 1]);

  addCasing([from, to], 3, group);
  const line = L.polyline([from, to], {
    color: displayColor,
    weight: 3,
    opacity: 1,
  }).addTo(group);

  const fromPoint = map.project(L.latLng(from), 0);
  const toPoint = map.project(L.latLng(to), 0);
  const rawAngle =
    (Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x) * 180) /
    Math.PI;
  const angle = Number.isFinite(rawAngle) ? rawAngle : 0;

  L.marker(to, {
    interactive: false,
    icon: L.divIcon({
      className: "rp-glyph-wrap",
      html: `<div class="rp-arrowhead" style="--glyph:${displayColor}; transform: rotate(${angle}deg)"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    }),
  }).addTo(group);

  return line;
}
