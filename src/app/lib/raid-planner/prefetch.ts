import type { GameMode } from "@/components/game-mode/context";
import { prefetchMapDetails } from "@/app/lib/cache/raidPlanner";
import { loadMapSvg } from "./map-svg";
import type { MapConfig } from "./types";

const prefetched = new Set<string>();

export function prefetchMap(config: MapConfig, gameMode: GameMode) {
  const key = `${config.key}:${gameMode}`;
  if (prefetched.has(key)) return;
  prefetched.add(key);
  void import("@/app/components/raid-planner/plan-editor-canvas").catch(() => undefined);
  prefetchMapDetails(config.key, gameMode);
  if (config.svgPath) void loadMapSvg(config.svgPath).catch(() => undefined);
}
