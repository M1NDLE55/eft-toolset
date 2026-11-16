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
import { SPAWN_AREA_PADDING_METERS, spawnAreas, type SpawnAreaPoint } from "./spawn-areas";

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
      COLORS[faction as keyof typeof COLORS] ?? COLORS.shared,
      EXTRACT_FACTION_LABELS[faction] ?? "Extract"
    );
  }

  if (id.startsWith("spawns:")) {
    const kind = id.slice("spawns:".length) as SpawnKind;
    const spec = SPAWN_KINDS.find((s) => s.kind === kind);
    if (!spec) return null;
    return buildSpawnAreas(
      details.spawns.filter((s) => s.kind === kind),
      spec
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

const EXTRACT_FACTION_LABELS: Record<string, string> = {
  pmc: "PMC extract",
  scav: "Scav extract",
  shared: "Shared extract",
};

/** Map event fired when markers that place names should keep clear of come or go. */
const LABEL_OBSTACLES_EVENT = "rp:labelobstacles";
const LABEL_OBSTACLE_SELECTOR = ".rp-extract";
const VISIBLE_OBSTACLE_SELECTOR = ".rp-extract:not(.rp-extract--crowded)";

const EXIT_ICON =
  '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 2.5h-4v11h4"/><path d="M7 8h7M11 5l3 3-3 3"/></svg>';

/** A pill naming the extract, so it reads as an exit without hovering it. */
function extractIcon(name: string, color: string) {
  const chip = document.createElement("span");
  chip.className = "rp-extract";
  chip.style.setProperty("--glyph", color);
  const icon = document.createElement("span");
  icon.className = "rp-extract-icon";
  icon.innerHTML = EXIT_ICON;
  const text = document.createElement("span");
  text.className = "rp-extract-name";
  text.textContent = name;
  chip.append(icon, text);
  return L.divIcon({ className: "rp-extract-wrap", html: chip, iconSize: [0, 0] });
}

function extractDescription(extract: MapExtract, factionLabel: string) {
  const parts = [`${extract.name} — ${factionLabel}`];
  if (extract.transferItem) {
    parts.push(`costs ${extract.transferItem.count.toLocaleString("en-US")} × ${extract.transferItem.name}`);
  }
  return parts.join(", ");
}

function buildExtracts(extracts: MapExtract[], color: string, factionLabel: string): LayerEntry {
  const group = L.layerGroup();
  const dimmables: Dimmable[] = [];
  // Zones stay hidden to keep the map clean; hovering an extract's pill shows its zone.
  const hiddenStyle = { opacity: 0, fillOpacity: 0, weight: 2 };
  const shownStyle = { opacity: 1, fillOpacity: 0.3, weight: 2 };
  const dimmedStyle = { opacity: 0.25, fillOpacity: 0.08, weight: 2 };

  for (const extract of extracts) {
    let polygon: L.Polygon | null = null;
    let dimmed = false;
    let hovered = false;
    const restyle = () =>
      polygon?.setStyle(!hovered ? hiddenStyle : dimmed ? dimmedStyle : shownStyle);
    const setHovered = (next: boolean) => {
      hovered = next;
      restyle();
    };

    if (extract.outline.length >= 3) {
      polygon = L.polygon(
        extract.outline.map((p) => gameToLatLng(p)),
        { color, interactive: false, ...hiddenStyle }
      );
      polygon.addTo(group);
      dimmables.push({
        top: extract.top ?? extract.position.y,
        bottom: extract.bottom ?? extract.position.y,
        position: extract.position,
        setDimmed: (next) => {
          dimmed = next;
          restyle();
        },
      });
    }

    // Hovering the pill fades it (see globals.css) and shows the zone under it.
    const marker = L.marker(gameToLatLng(extract.position), {
      icon: extractIcon(extract.name, color),
      riseOnHover: true,
    });
    marker.on("mouseover", () => setHovered(true));
    marker.on("mouseout", () => setHovered(false));
    marker.on("add", () => {
      const element = marker.getElement();
      element?.addEventListener("focus", () => setHovered(true));
      element?.addEventListener("blur", () => setHovered(false));
    });
    // The pill already names the extract, so it has no tooltip; screen readers get the full description.
    makeLayerAccessible(marker, extractDescription(extract, factionLabel));
    marker.addTo(group);
    dimmables.push(
      markerDimmable(marker, extract.position, extract.top, extract.bottom)
    );
  }

  announceLabelObstacles(group);
  return { group, dimmables };
}

const COMPACT_EXTRACT_CLASS = "rp-extract--compact";
const HIDDEN_EXTRACT_CLASS = "rp-extract--crowded";
const extractFrames = new WeakMap<L.Map, number>();

/**
 * Where extract pills overlap, later ones shrink to their icon (the name stays
 * in the tooltip), and any that still overlap wait for a closer zoom; then the
 * place names re-check for overlaps.
 */
function declutterExtracts(map: L.Map) {
  extractFrames.delete(map);
  const chips = Array.from(map.getContainer().querySelectorAll<HTMLElement>(LABEL_OBSTACLE_SELECTOR));
  for (const chip of chips) chip.classList.remove(COMPACT_EXTRACT_CLASS, HIDDEN_EXTRACT_CLASS);
  const kept: DOMRect[] = [];
  const crowded = (rect: DOMRect) =>
    kept.some(
      (other) =>
        rect.left < other.right + LABEL_GAP_PX &&
        rect.right + LABEL_GAP_PX > other.left &&
        rect.top < other.bottom + LABEL_GAP_PX &&
        rect.bottom + LABEL_GAP_PX > other.top
    );
  for (const chip of chips) {
    let rect = chip.getBoundingClientRect();
    if (crowded(rect)) {
      chip.classList.add(COMPACT_EXTRACT_CLASS);
      rect = chip.getBoundingClientRect();
      if (crowded(rect)) {
        chip.classList.add(HIDDEN_EXTRACT_CLASS);
        continue;
      }
    }
    kept.push(rect);
  }
  map.fire(LABEL_OBSTACLES_EVENT);
}

function scheduleExtractDeclutter(map: L.Map) {
  if (extractFrames.has(map) || typeof requestAnimationFrame !== "function") return;
  extractFrames.set(map, requestAnimationFrame(() => declutterExtracts(map)));
}

/** Re-checks extract and place-name overlaps when this group is shown, hidden, or zoomed. */
function announceLabelObstacles(group: L.LayerGroup) {
  let attached: L.Map | null = null;
  const schedule = () => attached && scheduleExtractDeclutter(attached);
  group.on("add", () => {
    attached = (group as unknown as { _map: L.Map | null })._map;
    attached?.on("zoomend resize", schedule);
    schedule();
  });
  group.on("remove", () => {
    attached?.off("zoomend resize", schedule);
    schedule();
    attached = null;
  });
}

/**
 * Spawns drawn as soft-edged areas rather than exact points: where you will
 * roughly start matters more than the exact spot.
 */
function buildSpawnAreas(
  spawns: SpawnAreaPoint[],
  spec: { label: string; color: string }
): LayerEntry {
  const group = L.layerGroup();
  const dimmables: Dimmable[] = [];
  const baseStyle = { opacity: 0, fillOpacity: 0.55 };
  const hoverStyle = { opacity: 0, fillOpacity: 0.8 };
  // A lighter tint than the layer colour, so the area stands out from grass and concrete.
  const fill = lighten(spec.color, 0.3);

  for (const area of spawnAreas(spawns)) {
    const polygon = L.polygon(
      area.outline.map((p) => gameToLatLng(p)),
      { color: fill, fillColor: fill, weight: 0, className: "rp-spawn-area", ...baseStyle }
    );
    const points = area.count === 1 ? "1 spawn point" : `${area.count} spawn points`;
    const tooltip = area.zone
      ? `${spec.label} spawn — ${area.zone} (${points})`
      : `${spec.label} spawn (${points})`;
    bindTooltip(polygon, tooltip);

    let dimmed = false;
    const restingStyle = () =>
      dimmed
        ? { opacity: 0, fillOpacity: baseStyle.fillOpacity * 0.2 }
        : baseStyle;
    polygon.on("mouseover", () => polygon.setStyle(dimmed ? restingStyle() : hoverStyle));
    polygon.on("mouseout", () => polygon.setStyle(restingStyle()));
    polygon.on("add", () => {
      const map = (polygon as unknown as { _map: L.Map | null })._map;
      const element = polygon.getElement();
      if (map && element) element.setAttribute("filter", `url(#${softEdgeFilter(map)})`);
    });

    polygon.addTo(group);
    dimmables.push({
      top: area.top,
      bottom: area.bottom,
      position: area.centre,
      setDimmed: (next) => {
        dimmed = next;
        polygon.setStyle(restingStyle());
      },
    });
  }

  let attached: L.Map | null = null;
  const resize = () => attached && updateSoftEdge(attached);
  group.on("add", () => {
    attached = (group as unknown as { _map: L.Map | null })._map;
    attached?.on("zoomend", resize);
    resize();
  });
  group.on("remove", () => {
    attached?.off("zoomend", resize);
    attached = null;
  });

  return { group, dimmables };
}

function lighten(hex: string, amount: number) {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `#${channels
    .map((channel) => Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The id of a blur filter, made once per map, that feathers spawn areas' edges. */
function softEdgeFilter(map: L.Map): string {
  const id = `rp-soft-edge-${L.stamp(map)}`;
  const container = map.getContainer();
  if (container.querySelector(`#${id}`)) return id;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  const filter = document.createElementNS(SVG_NS, "filter");
  filter.id = id;
  for (const [name, value] of [["x", "-100%"], ["y", "-100%"], ["width", "300%"], ["height", "300%"]]) {
    filter.setAttribute(name, value);
  }
  const blur = document.createElementNS(SVG_NS, "feGaussianBlur");
  filter.append(blur);
  svg.append(filter);
  container.append(svg);
  updateSoftEdge(map);
  return id;
}

/** Scales the blur with the zoom so an area's edge always fades over part of its padding. */
function updateSoftEdge(map: L.Map) {
  const blur = map
    .getContainer()
    .querySelector(`#rp-soft-edge-${L.stamp(map)} feGaussianBlur`);
  if (!blur) return;
  const origin = map.latLngToLayerPoint(gameToLatLng({ x: 0, z: 0 }));
  const step = map.latLngToLayerPoint(gameToLatLng({ x: SPAWN_AREA_PADDING_METERS, z: 0 }));
  const paddingPx = origin.distanceTo(step);
  const deviation = Math.min(Math.max(paddingPx * 0.3, 1.5), 12);
  blur.setAttribute("stdDeviation", deviation.toFixed(1));
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
    const kept: DOMRect[] = attached
      ? Array.from(attached.getContainer().querySelectorAll(VISIBLE_OBSTACLE_SELECTOR), (element) =>
          element.getBoundingClientRect()
        )
      : [];
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
    attached?.on(`zoomend resize ${LABEL_OBSTACLES_EVENT}`, scheduleDeclutter);
    scheduleDeclutter();
  });
  group.on("remove", () => {
    attached?.off(`zoomend resize ${LABEL_OBSTACLES_EVENT}`, scheduleDeclutter);
    attached = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  });

  return { group, dimmables };
}
