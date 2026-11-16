import type { GamePoint, MapConfig, RaidPlan } from "./types";

export interface PlanThumbnail {
  width: number;
  height: number;
  /** The route as SVG polyline points, empty when the plan has fewer than two waypoints. */
  route: string;
  waypoints: { x: number; y: number }[];
  drawings: { color: string; points: string }[];
  notes: { x: number; y: number; color: string }[];
}

const PADDING = 10;

/** Screen position of a game point, oriented the way the map draws it (unscaled). */
function project(point: GamePoint, config: Pick<MapConfig, "transform" | "coordinateRotation">) {
  const angle = (config.coordinateRotation * Math.PI) / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const [scaleX, , scaleY] = config.transform;
  return {
    x: scaleX * (point.x * cos - point.z * sin),
    y: -scaleY * (point.x * sin + point.z * cos),
  };
}

/**
 * A plan's route, drawings and notes fitted into a box, for a preview without the map behind it.
 * Returns null when the plan has nothing drawn.
 */
export function planThumbnail(
  plan: Pick<RaidPlan, "route" | "drawings" | "notes">,
  config: Pick<MapConfig, "transform" | "coordinateRotation">,
  width: number,
  height: number
): PlanThumbnail | null {
  const route = plan.route.map((waypoint) => project(waypoint.position, config));
  const drawings = plan.drawings.map((drawing) => ({
    color: drawing.color,
    points: drawing.points.map((point) => project(point, config)),
  }));
  const notes = plan.notes.map((note) => ({ ...project(note.position, config), color: note.color }));
  const all = [...route, ...drawings.flatMap((drawing) => drawing.points), ...notes].filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
  );
  if (all.length === 0) return null;

  const minX = Math.min(...all.map((point) => point.x));
  const maxX = Math.max(...all.map((point) => point.x));
  const minY = Math.min(...all.map((point) => point.y));
  const maxY = Math.max(...all.map((point) => point.y));
  const scale = Math.min(
    (width - PADDING * 2) / Math.max(maxX - minX, 1e-6),
    (height - PADDING * 2) / Math.max(maxY - minY, 1e-6),
    // A single point, or a tiny scribble, stays a sensible size instead of filling the box.
    4
  );
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const fit = (point: { x: number; y: number }) => ({
    x: Math.round((offsetX + (point.x - minX) * scale) * 10) / 10,
    y: Math.round((offsetY + (point.y - minY) * scale) * 10) / 10,
  });
  const line = (points: { x: number; y: number }[]) =>
    points.map(fit).map((point) => `${point.x},${point.y}`).join(" ");

  return {
    width,
    height,
    route: route.length > 1 ? line(route) : "",
    waypoints: route.map(fit),
    drawings: drawings
      .filter((drawing) => drawing.points.length > 1)
      .map((drawing) => ({ color: drawing.color, points: line(drawing.points) })),
    notes: notes.map((note) => ({ ...fit(note), color: note.color })),
  };
}
