import L from "leaflet";
import type { GamePoint, MapConfig } from "./types";

export function gameToLatLng(point: GamePoint): L.LatLngExpression {
  return [point.z, point.x];
}

export function latLngToGame(latLng: L.LatLng): GamePoint {
  return { x: latLng.lng, z: latLng.lat };
}

function applyRotation(latLng: L.LatLng, rotation: number): L.LatLng {
  if (!latLng.lng && !latLng.lat) {
    return L.latLng(0, 0);
  }
  if (!rotation) {
    return latLng;
  }

  const angleInRadians = (rotation * Math.PI) / 180;
  const cosAngle = Math.cos(angleInRadians);
  const sinAngle = Math.sin(angleInRadians);

  const { lng: x, lat: y } = latLng;
  return L.latLng(x * sinAngle + y * cosAngle, x * cosAngle - y * sinAngle);
}

export function getMapCRS(config: MapConfig): L.CRS {
  const [scaleX, marginX, rawScaleY, marginY] = config.transform;
  const rotation = config.coordinateRotation;

  return L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(scaleX, marginX, rawScaleY * -1, marginY),
    projection: L.extend({}, L.Projection.LonLat, {
      project: (latLng: L.LatLng) =>
        L.Projection.LonLat.project(applyRotation(latLng, rotation)),
      unproject: (point: L.Point) =>
        applyRotation(L.Projection.LonLat.unproject(point), rotation * -1),
    }),
  }) as L.CRS;
}

export function getMapBounds(
  bounds: [[number, number], [number, number]]
): L.LatLngBounds {
  return L.latLngBounds(
    [bounds[0][1], bounds[0][0]],
    [bounds[1][1], bounds[1][0]]
  );
}

export function getScaledBounds(
  bounds: [[number, number], [number, number]],
  scaleFactor: number
): L.LatLngBounds {
  const centerX = (bounds[0][0] + bounds[1][0]) / 2;
  const centerZ = (bounds[0][1] + bounds[1][1]) / 2;
  const width = Math.abs(bounds[1][0] - bounds[0][0]) * scaleFactor;
  const height = Math.abs(bounds[1][1] - bounds[0][1]) * scaleFactor;

  return L.latLngBounds(
    [centerZ - height / 2, centerX - width / 2],
    [centerZ + height / 2, centerX + width / 2]
  );
}
