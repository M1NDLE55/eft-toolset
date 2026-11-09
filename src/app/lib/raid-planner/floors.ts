import type { MapConfig, MapFloor } from "./types";

export interface FloorOption {
  id: string | null;
  name: string;
}

type HeightKey = [number, number];

function floorKey(floor: MapFloor): HeightKey {
  const heights = floor.extents?.map((extent) => extent.height) ?? [];
  if (heights.length === 0) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  return [Math.min(...heights.map(([low]) => low)), Math.max(...heights.map(([, high]) => high))];
}

function compareKeys(a: HeightKey, b: HeightKey) {
  return a[0] - b[0] || a[1] - b[1];
}

export function baseFloorName(config: MapConfig) {
  return config.baseFloorName ?? "Ground";
}

export function getFloorStack(config: MapConfig): FloorOption[] {
  const baseKey: HeightKey = config.heightRange ?? [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const sorted = config.floors
    .map((floor, index) => ({ floor, index, key: floorKey(floor) }))
    .sort((a, b) => compareKeys(b.key, a.key) || a.index - b.index);
  const above = sorted.filter((entry) => compareKeys(entry.key, baseKey) > 0);
  const below = sorted.filter((entry) => compareKeys(entry.key, baseKey) <= 0);
  const option = ({ floor }: { floor: MapFloor }): FloorOption => ({ id: floor.id, name: floor.name });
  return [...above.map(option), { id: null, name: baseFloorName(config) }, ...below.map(option)];
}

export function floorName(config: MapConfig, floorId: string | null) {
  return config.floors.find((floor) => floor.id === floorId)?.name ?? baseFloorName(config);
}
