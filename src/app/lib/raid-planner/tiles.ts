import L from "leaflet";
import type { MapConfig, TileGrid } from "./types";
import { getMapBounds } from "./coords";

interface TileCoords {
  x: number;
  y: number;
  z: number;
}

export function isTileInGrid(grid: TileGrid | undefined, coords: TileCoords): boolean {
  const size = grid?.[String(coords.z)];
  if (!size) return true;
  return coords.x >= 0 && coords.y >= 0 && coords.x < size[0] && coords.y < size[1];
}

type GridLayerInternals = { _isValidTile: (coords: L.Coords) => boolean };

const baseIsValidTile = (L.TileLayer.prototype as unknown as GridLayerInternals)._isValidTile;

const GridTileLayer = L.TileLayer.extend({
  _isValidTile(this: L.TileLayer & { options: { tileGrid?: TileGrid } }, coords: L.Coords) {
    return isTileInGrid(this.options.tileGrid, coords) && baseIsValidTile.call(this, coords);
  },
}) as unknown as new (url: string, options: L.TileLayerOptions & { tileGrid?: TileGrid }) => L.TileLayer;

export function createMapTileLayer(
  config: MapConfig,
  tilePath: string,
  options: L.TileLayerOptions = {}
): L.TileLayer {
  return new GridTileLayer(tilePath, {
    tileSize: config.tileSize,
    bounds: getMapBounds(config.bounds),
    maxNativeZoom: config.maxZoom,
    maxZoom: Math.max(7, config.maxZoom),
    tileGrid: config.tileGrid,
    ...options,
  });
}
