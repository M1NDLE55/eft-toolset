import L from "leaflet";
import type {
  MapDetails,
  MapExtract,
  SpawnKind,
} from "@/app/lib/types/raidPlanner";
import type { FloorExtent, GamePoint, MapConfig, MapLabel } from "./types";
import { LABELS_LAYER } from "./layer-options";
import { gameToLatLng } from "./coords";
import { itemHref } from "@/app/lib/item-links";
import { makeLayerAccessible } from "./leaflet-accessibility";

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
  config: Pick<MapConfig, "labels">;
  details: MapDetails | null;
  renderer: L.Canvas;
}

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
  if (id === LABELS_LAYER) return buildLabels(context.config.labels ?? []);

  const { details } = context;
  if (!details) return null;
  const detailContext = { ...context, details };

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
      return buildLocks(detailContext);
    case "hazards":
      return buildHazards(detailContext);
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
  const content = document.createElement("span");
  content.textContent = text;
  layer.bindTooltip(content, { direction: "top", offset: [0, -8] });
  makeLayerAccessible(layer, text);
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
      ...(points.length > 500 ? { renderer: style.renderer } : {}),
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

type DetailContext = LayerBuildContext & { details: MapDetails };

function buildLocks(context: DetailContext): LayerEntry {
  const group = L.layerGroup();
  const dimmables: Dimmable[] = [];

  for (const lock of context.details.locks) {
    const marker = L.marker(gameToLatLng(lock.position), {
      icon: glyphIcon("triangle", COLORS.lock),
    });

    const title = LOCK_TYPE_LABELS[lock.lockType] ?? "Lock";
    bindTooltip(marker, lock.keyName ? `${title} — ${lock.keyName}` : title);

    if (lock.keyName) {
      const popup = document.createElement("div");
      popup.className = "rp-popup";
      const heading = document.createElement("p");
      heading.className = "rp-popup-title";
      heading.textContent = title;
      const keyLine = document.createElement("p");
      keyLine.append("Key: ");
      const keyLink = document.createElement("a");
      keyLink.href = itemHref({ name: lock.keyName, normalizedName: lock.keyNormalizedName });
      keyLink.textContent = lock.keyName;
      keyLine.append(keyLink);
      popup.append(heading, keyLine);
      if (lock.needsPower) {
        const power = document.createElement("p");
        power.textContent = "Requires power";
        popup.append(power);
      }
      marker.bindPopup(popup, { closeButton: false });
    }

    marker.addTo(group);
    dimmables.push(markerDimmable(marker, lock.position));
  }

  return { group, dimmables };
}

function buildHazards(context: DetailContext): LayerEntry {
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

const LABEL_BASE_PX = 12;
const LABEL_GAP_PX = 4;
const HIDDEN_LABEL_CLASS = "rp-label--crowded";

/**
 * Place names drawn as plain text under every marker; they never take clicks.
 * Labels from other floors are hidden, and where labels collide only the larger
 * (or earlier) one stays visible until the map is zoomed in far enough.
 */
function buildLabels(labels: MapLabel[]): LayerEntry {
  const group = L.layerGroup();
  const dimmables: Dimmable[] = [];
  const placed: { marker: L.Marker; size: number }[] = [];

  labels.forEach((label) => {
    const [x, z] = label.position;
    const top = label.top ?? 100000;
    const bottom = label.bottom ?? -100000;
    const position = { x, z, y: label.top !== undefined && label.bottom !== undefined ? (top + bottom) / 2 : 0 };
    const text = document.createElement("span");
    text.className = "rp-label";
    text.textContent = label.text;
    const size = label.size ?? 100;
    const scale = Math.min(Math.max(size / 100, 0.75), 1.5);
    text.style.fontSize = `${Math.round(LABEL_BASE_PX * scale)}px`;
    if (label.rotation) text.style.rotate = `${label.rotation}deg`;

    const marker = L.marker(gameToLatLng(position), {
      icon: L.divIcon({ className: "rp-label-wrap", html: text, iconSize: [0, 0] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: -1000,
    });
    marker.addTo(group);
    placed.push({ marker, size });
    const dimmable = markerDimmable(marker, position, top, bottom);
    dimmables.push({
      ...dimmable,
      setDimmed: (dimmed) => {
        dimmable.setDimmed(dimmed);
        scheduleDeclutter();
      },
    });
  });

  const ranked = [...placed].sort((a, b) => b.size - a.size);
  let frame = 0;

  function declutter() {
    frame = 0;
    const candidates = ranked
      .map(({ marker }) => marker.getElement())
      .filter((element): element is HTMLElement => Boolean(element) && !element!.classList.contains("rp-off-level"));
    for (const element of candidates) element.classList.remove(HIDDEN_LABEL_CLASS);
    const rects = candidates.map((element) => element.firstElementChild?.getBoundingClientRect());
    const kept: DOMRect[] = [];
    candidates.forEach((element, index) => {
      const rect = rects[index];
      if (!rect) return;
      const crowded = kept.some(
        (other) =>
          rect.left < other.right + LABEL_GAP_PX &&
          rect.right + LABEL_GAP_PX > other.left &&
          rect.top < other.bottom + LABEL_GAP_PX &&
          rect.bottom + LABEL_GAP_PX > other.top
      );
      if (crowded) element.classList.add(HIDDEN_LABEL_CLASS);
      else kept.push(rect);
    });
  }

  function scheduleDeclutter() {
    if (!frame && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(declutter);
  }

  let attached: L.Map | null = null;
  group.on("add", () => {
    attached = (group as unknown as { _map: L.Map | null })._map;
    attached?.on("zoomend resize", scheduleDeclutter);
    scheduleDeclutter();
  });
  group.on("remove", () => {
    attached?.off("zoomend resize", scheduleDeclutter);
    attached = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  });

  return { group, dimmables };
}
