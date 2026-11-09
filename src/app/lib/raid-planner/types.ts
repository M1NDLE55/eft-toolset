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
  height: [number, number];
  bounds?: [[number, number], [number, number]][];
}

export interface MapFloor {
  id: string;
  name: string;
  tilePath?: string;
  svgLayer?: string;
  show?: boolean;
  extents?: FloorExtent[];
}

export type TileGrid = Record<string, [number, number]>;

export interface MapConfig {
  key: string;
  name: string;
  strategy: "tile" | "svg";
  tilePath?: string;
  svgPath?: string;
  svgLayer?: string;
  svgBounds?: [[number, number], [number, number]];
  tileSize: number;
  minZoom: number;
  maxZoom: number;
  transform: [number, number, number, number];
  coordinateRotation: number;
  bounds: [[number, number], [number, number]];
  heightRange?: [number, number];
  baseFloorName?: string;
  floors: MapFloor[];
  author?: string;
  authorLink?: string;
  tileGrid?: TileGrid;
}
