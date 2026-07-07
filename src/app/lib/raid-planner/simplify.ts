import type { GamePoint } from "./types";

/**
 * Douglas-Peucker polyline simplification in game coordinates (meters).
 * Freehand pen strokes are thinned with this before saving so localStorage
 * stays small and share payloads stay viable.
 */
export function simplifyPoints(
  points: GamePoint[],
  tolerance = 0.5
): GamePoint[] {
  if (points.length <= 2) return points;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDistance = 0;
    let index = -1;

    for (let i = first + 1; i < last; i += 1) {
      const distance = pointToSegment(points[i], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

function pointToSegment(p: GamePoint, a: GamePoint, b: GamePoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;

  let t = 0;
  if (lengthSquared > 0) {
    t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }

  const nearestX = a.x + t * dx;
  const nearestZ = a.z + t * dz;
  return Math.hypot(p.x - nearestX, p.z - nearestZ);
}
