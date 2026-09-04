export interface GamePoint {
  x: number;
  z: number;
  y?: number;
}

export type PlanTool =
  | "select"
  | "route"
  | "pen"
  | "arrow"
  | "note"
  | "eraser"
  | "measure";

/** Tactical palette for drawings and notes. */
export const PLAN_COLORS = [
  "#c8b384",
  "#9bc878",
  "#e2a852",
  "#d46b6b",
  "#78b6d2",
  "#f0f0f0",
] as const;

const LEGACY_PLAN_COLORS: Record<string, (typeof PLAN_COLORS)[number]> = {
  "#9a8866": PLAN_COLORS[0],
  "#7da05f": PLAN_COLORS[1],
  "#c08a3e": PLAN_COLORS[2],
  "#a04f4f": PLAN_COLORS[3],
  "#5f8aa0": PLAN_COLORS[4],
  "#cccccc": PLAN_COLORS[5],
};

/** Brightens drawings created with the original muted palette. */
export function getPlanDisplayColor(color: string): string {
  const normalized = color.toLowerCase();
  return (
    LEGACY_PLAN_COLORS[normalized] ??
    PLAN_COLORS.find((candidate) => candidate === normalized) ??
    PLAN_COLORS[0]
  );
}

export interface Waypoint {
  id: string;
  position: GamePoint;
}

export interface Drawing {
  id: string;
  kind: "pen" | "arrow";
  color: string;
  /** pen: full polyline; arrow: [from, to]. Stored in game coordinates. */
  points: GamePoint[];
}

export interface NotePin {
  id: string;
  position: GamePoint;
  title: string;
  body: string;
  color: string;
}

export interface RaidPlan {
  id: string;
  name: string;
  mapKey: string;
  createdAt: number;
  updatedAt: number;
  enabledLayers: string[];
  route: Waypoint[];
  drawings: Drawing[];
  notes: NotePin[];
}

export interface FloorExtent {
  /** Game-coordinate y range [bottom, top] this floor covers. */
  height: [number, number];
  /** Optional [x, z] corner-pair rectangles limiting where the range applies. */
  bounds?: [[number, number], [number, number]][];
}

export interface MapFloor {
  id: string;
  name: string;
  /** Tile pyramid for this floor (tile-strategy maps). */
  tilePath?: string;
  /** SVG group id for this floor (svg-strategy maps). */
  svgLayer?: string;
  /** Floor that should be active when the map opens (e.g. Interchange 2nd floor). */
  show?: boolean;
  extents?: FloorExtent[];
}

export interface MapConfig {
  key: string;
  name: string;
  /**
   * How the base imagery renders. "tile" maps use z/x/y pyramids for the base
   * and every floor; "svg" maps use a single SVG overlay whose top-level groups
   * are the floors.
   */
  strategy: "tile" | "svg";
  tilePath?: string;
  svgPath?: string;
  /** SVG group id of the ground level (svg-strategy maps). */
  svgLayer?: string;
  /** Explicit bounds for the SVG overlay when they differ from `bounds`. */
  svgBounds?: [[number, number], [number, number]];
  tileSize: number;
  minZoom: number;
  maxZoom: number;
  /** [scaleX, marginX, scaleY, marginY] — game coords → leaflet CRS. */
  transform: [number, number, number, number];
  coordinateRotation: number;
  /** Game-coordinate corners as [x, z] pairs. */
  bounds: [[number, number], [number, number]];
  /** Game-coordinate y range covered by the ground level. */
  heightRange?: [number, number];
  floors: MapFloor[];
  author?: string;
  authorLink?: string;
}
