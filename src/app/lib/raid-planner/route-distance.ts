import type { Waypoint } from "./types";

export function routeLength(route: Waypoint[]): number {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1].position;
    const to = route[index].position;
    total += Math.hypot(to.x - from.x, to.z - from.z);
  }
  return total;
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
  return `${Math.round(meters)} m`;
}
