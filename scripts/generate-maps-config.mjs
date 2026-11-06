import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE_URL =
  "https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json";

const DISPLAY_NAMES = {
  "streets-of-tarkov": "Streets of Tarkov",
  "ground-zero": "Ground Zero",
  customs: "Customs",
  factory: "Factory",
  interchange: "Interchange",
  "the-lab": "The Lab",
  "the-labyrinth": "The Labyrinth",
  lighthouse: "Lighthouse",
  reserve: "Reserve",
  shoreline: "Shoreline",
  terminal: "Terminal",
  woods: "Woods",
};

const BASE_FLOOR_NAMES = {
  "the-lab": "1st Floor",
};

const FLOOR_NAMES = {
  "the-lab": { "second-level": "2nd Floor" },
};

function floorId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const PROBE_CONCURRENCY = 8;
const tileStatusCache = new Map();

async function tileExists(tilePath, z, x, y) {
  if (x < 0 || y < 0) return false;
  const url = tilePath.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  if (!tileStatusCache.has(url)) {
    tileStatusCache.set(
      url,
      (async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const result = await fetch(url, { method: "HEAD" }).catch(() => null);
          if (result && (result.status === 200 || result.status === 404 || result.status === 403)) {
            return result.status === 200;
          }
        }
        throw new Error(`Could not probe ${url}`);
      })()
    );
  }
  return tileStatusCache.get(url);
}

async function measureAxis(probe) {
  if (!(await probe(0))) return 0;
  let low = 0;
  let high = 1;
  while (await probe(high)) {
    low = high;
    high *= 2;
    if (high > 1 << 16) throw new Error("Tile grid is unexpectedly large.");
  }
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (await probe(middle)) low = middle;
    else high = middle;
  }
  return high;
}

async function measureTileGrid(tilePath, z) {
  const side = 2 ** z;
  const [lastCorner, pastColumn, pastRow, pastCorner] = await Promise.all([
    tileExists(tilePath, z, side - 1, side - 1),
    tileExists(tilePath, z, side, 0),
    tileExists(tilePath, z, 0, side),
    tileExists(tilePath, z, side, side),
  ]);
  if (lastCorner && !pastColumn && !pastRow && !pastCorner) return [side, side];
  const columns = await measureAxis((x) => tileExists(tilePath, z, x, 0));
  const rows = await measureAxis((y) => tileExists(tilePath, z, 0, y));
  return [columns, rows];
}

async function mapInBatches(items, task) {
  const results = [];
  for (let index = 0; index < items.length; index += PROBE_CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(index, index + PROBE_CONCURRENCY).map(task))));
  }
  return results;
}

async function computeTileGrid(config) {
  const paths = [config.tilePath, ...config.floors.map((floor) => floor.tilePath)].filter(Boolean);
  const zooms = [];
  for (let z = config.minZoom; z <= config.maxZoom; z += 1) zooms.push(z);
  const grid = {};
  for (const z of zooms) {
    const sizes = await mapInBatches(paths, (path) => measureTileGrid(path, z));
    const columns = Math.min(...sizes.map(([value]) => value));
    const rows = Math.min(...sizes.map(([, value]) => value));
    if (sizes.some(([c, r]) => c !== columns || r !== rows)) {
      console.warn(`"${config.key}" floors disagree on the zoom ${z} tile grid; using the smallest.`);
    }
    if (columns === 0 || rows === 0) throw new Error(`"${config.key}" has no tiles at zoom ${z}.`);
    grid[z] = [columns, rows];
  }
  return grid;
}

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`Failed to fetch maps.json: ${response.status}`);
}
const source = await response.json();

const configs = [];

for (const entry of source) {
  const interactive = entry.maps?.find((m) => m.projection === "interactive");
  if (!interactive) continue;

  const name = DISPLAY_NAMES[interactive.key];
  if (!name) {
    console.warn(`Skipping unknown map "${interactive.key}" — add a display name.`);
    continue;
  }

  const layers = interactive.layers ?? [];
  const strategy =
    interactive.tilePath && layers.every((layer) => layer.tilePath)
      ? "tile"
      : "svg";

  if (strategy === "svg" && !interactive.svgPath) {
    console.warn(`Skipping "${interactive.key}" — no usable tile or svg imagery.`);
    continue;
  }

  const floors = layers
    .map((layer) => {
      const id = floorId(layer.name);
      const floor = {
        id,
        name: FLOOR_NAMES[interactive.key]?.[id] ?? layer.name,
      };
      if (strategy === "tile") floor.tilePath = layer.tilePath;
      else floor.svgLayer = layer.svgLayer;
      if (layer.show) floor.show = true;
      if (layer.extents) {
        floor.extents = layer.extents.map((extent) => ({
          height: extent.height,
          ...(extent.bounds
            ? { bounds: extent.bounds.map((b) => [b[0], b[1]]) }
            : {}),
        }));
      }
      return floor;
    })
    .filter((floor) => (strategy === "tile" ? floor.tilePath : floor.svgLayer));

  const heightRange = interactive.heightRange ?? interactive._heightRange;

  configs.push({
    key: interactive.key,
    name,
    strategy,
    ...(strategy === "tile"
      ? { tilePath: interactive.tilePath }
      : {
          svgPath: interactive.svgPath,
          svgLayer: interactive.svgLayer,
          ...(interactive.svgBounds ? { svgBounds: interactive.svgBounds } : {}),
        }),
    tileSize: interactive.tileSize ?? 256,
    minZoom: interactive.minZoom ?? 1,
    maxZoom: interactive.maxZoom ?? 6,
    transform: interactive.transform,
    coordinateRotation: interactive.coordinateRotation ?? 0,
    bounds: interactive.bounds,
    ...(heightRange ? { heightRange } : {}),
    ...(BASE_FLOOR_NAMES[interactive.key] ? { baseFloorName: BASE_FLOOR_NAMES[interactive.key] } : {}),
    floors,
    ...(interactive.author ? { author: interactive.author } : {}),
    ...(interactive.authorLink ? { authorLink: interactive.authorLink } : {}),
  });
}

for (const config of configs) {
  if (config.strategy !== "tile") continue;
  config.tileGrid = await computeTileGrid(config);
  console.log(`Measured ${config.key} tile grid: ${JSON.stringify(config.tileGrid)}`);
}

const order = Object.keys(DISPLAY_NAMES);
configs.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

const body = `import type { MapConfig } from "./types";

export const mapConfigs: MapConfig[] = ${JSON.stringify(configs, null, 2)};

export function getMapConfig(key: string): MapConfig | undefined {
  return mapConfigs.find((config) => config.key === key);
}
`;

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "lib",
  "raid-planner",
  "maps-config.ts"
);
writeFileSync(outPath, body);
console.log(`Wrote ${configs.length} map configs to ${outPath}`);
