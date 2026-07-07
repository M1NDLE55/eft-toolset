// Builds Leaflet layer groups from map details and handles per-floor dimming.
// Client-only (imports leaflet); only map-canvas should import this.
import L from "leaflet";
import type {
  MapDetails,
  MapExtract,
  SpawnKind,
} from "@/app/lib/types/raidPlanner";
import type { FloorExtent, GamePoint, MapConfig } from "./types";
import { gameToLatLng } from "./coords";
import { customEncodeURI } from "@/app/lib/URIEncoding";

const COLORS = {
  pmc: "#7da05f",
  scav: "#c08a3e",
  shared: "#5f8aa0",
  transit: "#8a6fa0",
  sniper: "#a05050",
  boss: "#c04848",
  raider: "#8a8a8a",
  lock: "#b8a35e",
  hazard: "#a04f4f",
  switch: "#5f8aa0",
  stationary: "#9a8866",
  loot: "#9a8866",
} as const;

const SPAWN_KINDS: { kind: SpawnKind; label: string; color: string }[] = [
  { kind: "pmc", label: "PMC", color: COLORS.pmc },
  { kind: "scav", label: "Scav", color: COLORS.scav },
  { kind: "sniper", label: "Sniper scav", color: COLORS.sniper },
  { kind: "boss", label: "Boss", color: COLORS.boss },
  { kind: "raider", label: "Raider / Rogue", color: COLORS.raider },
];

interface Dimmable {
  top: number;
  bottom: number;
  position: GamePoint;
  setDimmed: (dimmed: boolean) => void;
}

export interface LayerEntry {
  group: L.LayerGroup;
  dimmables: Dimmable[];
}

export interface LayerBuildContext {
  details: MapDetails;
  renderer: L.Canvas;
}

/** Extents the active floor covers; ground level falls back to heightRange. */
export function getActiveExtents(
  config: MapConfig,
  activeFloor: string | null
): FloorExtent[] {
  if (activeFloor) {
    const floor = config.floors.find((f) => f.id === activeFloor);
    if (floor?.extents?.length) return floor.extents;
  }
  return [{ height: config.heightRange ?? [-100000, 100000] }];
}

function isOnFloor(dimmable: Dimmable, extents: FloorExtent[]): boolean {
  for (const extent of extents) {
    if (dimmable.top < extent.height[0] || dimmable.bottom >= extent.height[1]) {
      continue;
    }
    if (!extent.bounds) return true;
    for (const [[x1, z1], [x2, z2]] of extent.bounds) {
      const { x, z } = dimmable.position;
      if (
        x >= Math.min(x1, x2) &&
        x <= Math.max(x1, x2) &&
        z >= Math.min(z1, z2) &&
        z <= Math.max(z1, z2)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function applyFloorDimming(entry: LayerEntry, extents: FloorExtent[]) {
  for (const dimmable of entry.dimmables) {
    dimmable.setDimmed(!isOnFloor(dimmable, extents));
  }
}

export function buildLayer(
  id: string,
  context: LayerBuildContext
): LayerEntry | null {
  const { details } = context;

  if (id.startsWith("extracts:")) {
    const faction = id.slice("extracts:".length);
    return buildExtracts(
      details.extracts.filter((e) => e.faction === faction),
      COLORS[faction as keyof typeof COLORS] ?? COLORS.shared
    );
  }

  if (id.startsWith("spawns:")) {
    const kind = id.slice("spawns:".length) as SpawnKind;
    const spec = SPAWN_KINDS.find((s) => s.kind === kind);
    if (!spec) return null;
    return buildDots(
      details.spawns
        .filter((s) => s.kind === kind)
        .map((s) => ({
          position: s.position,
          tooltip: s.zoneName ? `${spec.label} — ${s.zoneName}` : spec.label,
        })),
      { color: spec.color, radius: 5, renderer: context.renderer }
    );
  }

  if (id.startsWith("loot:")) {
    const typeId = id.slice("loot:".length);
    return buildDots(
      details.lootContainers
        .filter((c) => c.typeId === typeId)
        .map((c) => ({ position: c.position, tooltip: c.typeName })),
      { color: COLORS.loot, radius: 3, renderer: context.renderer }
    );
  }

  switch (id) {
    case "transits":
      return buildGlyphs(
        details.transits.map((t) => ({
          position: t.position,
          tooltip: t.description,
        })),
        { shape: "diamond", color: COLORS.transit }
      );
    case "locks":
      return buildLocks(context);
    case "hazards":
      return buildHazards(context);
    case "switches":
      return buildGlyphs(
        details.switches.map((s) => ({
          position: s.position,
          tooltip: s.name ?? "Switch",
        })),
        { shape: "diamond", color: COLORS.switch }
      );
    case "stationary":
      return buildGlyphs(
        details.stationaryWeapons.map((w) => ({
          position: w.position,
          tooltip: w.name,
        })),
        { shape: "triangle", color: COLORS.stationary }
      );
    default:
      return null;
  }
}

type GlyphShape = "square" | "diamond" | "triangle";

function glyphIcon(shape: GlyphShape, color: string) {
  return L.divIcon({
    className: "rp-glyph-wrap",
    html: `<div class="rp-glyph rp-glyph--${shape}" style="--glyph:${color}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function markerDimmable(
  marker: L.Marker,
  position: Required<GamePoint>,
  top?: number | null,
  bottom?: number | null
): Dimmable {
  return {
    top: top ?? position.y,
    bottom: bottom ?? position.y,
    position,
    setDimmed: (dimmed) =>
      marker.getElement()?.classList.toggle("rp-off-level", dimmed),
  };
}

function pathDimmable(
  path: L.Path,
  baseStyle: { opacity: number; fillOpacity: number },
  position: Required<GamePoint>,
  top?: number | null,
  bottom?: number | null
): Dimmable {
  return {
    top: top ?? position.y,
    bottom: bottom ?? position.y,
    position,
    setDimmed: (dimmed) =>
      path.setStyle(
        dimmed
          ? { opacity: baseStyle.opacity * 0.2, fillOpacity: baseStyle.fillOpacity * 0.2 }
          : baseStyle
      ),
  };
}

interface PointSpec {
  position: Required<GamePoint>;
  tooltip: string;
  top?: number | null;
  bottom?: number | null;
}

function bindTooltip(layer: L.Layer, text: string) {
  layer.bindTooltip(text, { direction: "top", offset: [0, -8] });
}

function buildGlyphs(
  points: PointSpec[],
  style: { shape: GlyphShape; color: string }
): LayerEntry {
  const group = L.layerGroup();
  const dimmables: Dimmable[] = [];

  for (const point of points) {
    const marker = L.marker(gameToLatLng(point.position), {
      icon: glyphIcon(style.shape, style.color),
    });
    bindTooltip(marker, point.tooltip);
    marker.addTo(group);
    dimmables.push(markerDimmable(marker, point.position, point.top, point.bottom));
  }

  return { group, dimmables };
}

function buildDots(
  points: PointSpec[],
  style: { color: string; radius: number; renderer: L.Canvas }
): LayerEntry {
  const group = L.layerGroup();
  const dimmables: Dimmable[] = [];
  const baseStyle = { opacity: 0.9, fillOpacity: 0.5 };

  for (const point of points) {
    const marker = L.circleMarker(gameToLatLng(point.position), {
      renderer: style.renderer,
      radius: style.radius,
      color: style.color,
      weight: 1.5,
      ...baseStyle,
    });
    bindTooltip(marker, point.tooltip);
    marker.addTo(group);
    dimmables.push(
      pathDimmable(marker, baseStyle, point.position, point.top, point.bottom)
    );
  }

  return { group, dimmables };
}

function buildExtracts(extracts: MapExtract[], color: string): LayerEntry {
  const group = L.layerGroup();
  const dimmables: Dimmable[] = [];
  const outlineStyle = { opacity: 0.8, fillOpacity: 0.1 };

  for (const extract of extracts) {
    if (extract.outline.length >= 3) {
      const polygon = L.polygon(
        extract.outline.map((p) => gameToLatLng(p)),
        { color, weight: 1, ...outlineStyle }
      );
      polygon.addTo(group);
      dimmables.push(
        pathDimmable(polygon, outlineStyle, extract.position, extract.top, extract.bottom)
      );
    }

    const marker = L.marker(gameToLatLng(extract.position), {
      icon: glyphIcon("square", color),
    });
    bindTooltip(marker, extract.name);
    marker.addTo(group);
    dimmables.push(
      markerDimmable(marker, extract.position, extract.top, extract.bottom)
    );
  }

  return { group, dimmables };
}

const LOCK_TYPE_LABELS: Record<string, string> = {
  door: "Locked door",
  trunk: "Locked trunk",
  container: "Locked container",
  switch: "Locked switch",
};

function buildLocks(context: LayerBuildContext): LayerEntry {
  const group = L.layerGroup();
  const dimmables: Dimmable[] = [];

  for (const lock of context.details.locks) {
    const marker = L.marker(gameToLatLng(lock.position), {
      icon: glyphIcon("triangle", COLORS.lock),
    });

    const title = LOCK_TYPE_LABELS[lock.lockType] ?? "Lock";
    bindTooltip(marker, lock.keyName ? `${title} — ${lock.keyName}` : title);

    if (lock.keyName) {
      const keyLink = `<a href="/item/${customEncodeURI(lock.keyName)}">${lock.keyName}</a>`;
      marker.bindPopup(
        `<div class="rp-popup"><p class="rp-popup-title">${title}</p>` +
          `<p>Key: ${keyLink}</p>` +
          (lock.needsPower ? "<p>Requires power</p>" : "") +
          "</div>",
        { closeButton: false }
      );
    }

    marker.addTo(group);
    dimmables.push(markerDimmable(marker, lock.position));
  }

  return { group, dimmables };
}

function buildHazards(context: LayerBuildContext): LayerEntry {
  const group = L.layerGroup();
  const dimmables: Dimmable[] = [];
  const zoneStyle = { opacity: 0.7, fillOpacity: 0.12 };

  for (const hazard of context.details.hazards) {
    if (hazard.outline.length >= 3) {
      const polygon = L.polygon(
        hazard.outline.map((p) => gameToLatLng(p)),
        { color: COLORS.hazard, weight: 1, dashArray: "4 3", ...zoneStyle }
      );
      bindTooltip(polygon, hazard.name);
      polygon.addTo(group);
      dimmables.push(
        pathDimmable(polygon, zoneStyle, hazard.position, hazard.top, hazard.bottom)
      );
    } else {
      const marker = L.marker(gameToLatLng(hazard.position), {
        icon: glyphIcon("triangle", COLORS.hazard),
      });
      bindTooltip(marker, hazard.name);
      marker.addTo(group);
      dimmables.push(
        markerDimmable(marker, hazard.position, hazard.top, hazard.bottom)
      );
    }
  }

  return { group, dimmables };
}
