import type { Face, ScenePart, Vec3 } from "./build-scene";

// How each generic model from public/models/gun-parts.glb fits the box build-scene gives its part.
//
// Every model is authored in the same frame as the scene (centimetres, +x toward the muzzle,
// +y up, +z the gun's right side), sized like the box it usually fills, with a mount empty where
// it attaches to its parent. "stretch" models are scaled on each axis to fill the box exactly, so
// a 20-inch barrel is longer than a 14.5-inch one. "uniform" models keep their proportions (an
// optic or a grip squashed out of shape looks wrong), fit inside the box, and attach at their
// mount empty.

/**
 * Which way a model is built to attach: sitting on top of its mount, hanging below it, running
 * forward from it, running back from it, or centred on it.
 */
export type MountStyle = "up" | "down" | "rear" | "front" | "center";

export interface VariantSpec {
  mount: MountStyle;
  fit: "stretch" | "uniform";
}

export const VARIANT_SPECS: Record<string, VariantSpec> = {
  body_rifle: { mount: "center", fit: "stretch" },
  body_bullpup: { mount: "center", fit: "stretch" },
  body_pistol: { mount: "center", fit: "stretch" },
  body_plain: { mount: "center", fit: "stretch" },
  receiver_upper: { mount: "center", fit: "stretch" },
  dust_cover: { mount: "center", fit: "stretch" },
  slide: { mount: "center", fit: "stretch" },
  stock_shell: { mount: "center", fit: "stretch" },
  gas_block: { mount: "center", fit: "stretch" },
  barrel: { mount: "rear", fit: "stretch" },
  muzzle_flash_hider: { mount: "rear", fit: "stretch" },
  muzzle_brake: { mount: "rear", fit: "stretch" },
  muzzle_adapter: { mount: "rear", fit: "stretch" },
  suppressor: { mount: "rear", fit: "stretch" },
  gas_tube: { mount: "rear", fit: "stretch" },
  handguard_rail: { mount: "rear", fit: "stretch" },
  handguard_mlok: { mount: "rear", fit: "stretch" },
  handguard_classic: { mount: "rear", fit: "stretch" },
  mag_tube: { mount: "rear", fit: "stretch" },
  buffer_tube: { mount: "front", fit: "stretch" },
  stock_adjustable: { mount: "front", fit: "stretch" },
  stock_fixed: { mount: "front", fit: "stretch" },
  stock_skeleton: { mount: "front", fit: "stretch" },
  buttpad: { mount: "front", fit: "stretch" },
  mag_curved: { mount: "down", fit: "stretch" },
  mag_straight: { mount: "down", fit: "stretch" },
  mag_drum: { mount: "down", fit: "uniform" },
  grip: { mount: "down", fit: "uniform" },
  foregrip_vertical: { mount: "down", fit: "uniform" },
  foregrip_angled: { mount: "down", fit: "uniform" },
  bipod: { mount: "down", fit: "uniform" },
  launcher: { mount: "down", fit: "uniform" },
  rail: { mount: "up", fit: "stretch" },
  mag_top: { mount: "up", fit: "stretch" },
  optic_scope: { mount: "up", fit: "uniform" },
  optic_reddot: { mount: "up", fit: "uniform" },
  optic_holo: { mount: "up", fit: "uniform" },
  sight_rear: { mount: "up", fit: "uniform" },
  sight_front: { mount: "up", fit: "uniform" },
  tactical_light: { mount: "up", fit: "uniform" },
  tactical_laser: { mount: "up", fit: "uniform" },
  charge: { mount: "up", fit: "uniform" },
  generic: { mount: "up", fit: "uniform" },
};

/** A model's extent and mount point in its own frame. */
export interface ModelShape {
  min: Vec3;
  max: Vec3;
  mount: Vec3;
}

export type Quaternion = [number, number, number, number];

/** Place a model with `position`, `quaternion` and `scale` on a group, and `offset` on the model inside it. */
export interface ModelTransform {
  position: Vec3;
  quaternion: Quaternion;
  scale: Vec3;
  offset: Vec3;
}

const NORMALS: Record<Face, Vec3> = { top: [0, 1, 0], bottom: [0, -1, 0], right: [0, 0, 1], left: [0, 0, -1] };

function aroundX(angle: number): Quaternion {
  return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
}

function aroundZ(angle: number): Quaternion {
  return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
}

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Turns a model built for one side (up or down) to face the side its part sits on. */
function faceRotation(style: MountStyle, face: Face): Quaternion {
  const half = Math.PI / 2;
  if (style === "up") {
    return { top: aroundX(0), bottom: aroundX(Math.PI), right: aroundX(half), left: aroundX(-half) }[face];
  }
  if (style === "down") {
    return { bottom: aroundX(0), top: aroundX(Math.PI), right: aroundX(-half), left: aroundX(half) }[face];
  }
  return aroundX(0);
}

/** The point on the model's extent that a stretched model attaches by. */
function extentAnchor(style: MountStyle, min: Vec3, max: Vec3): Vec3 {
  const mid: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  switch (style) {
    case "up":
      return [mid[0], min[1], mid[2]];
    case "down":
      return [mid[0], max[1], mid[2]];
    case "rear":
      return [min[0], mid[1], mid[2]];
    case "front":
      return [max[0], mid[1], mid[2]];
    default:
      return mid;
  }
}

/** Where on the part's box its model attaches, in the scene. */
function boxAnchor(part: ScenePart, style: MountStyle): Vec3 {
  const [x, y, z] = part.center;
  const [sx, sy, sz] = part.size;
  switch (style) {
    case "up":
    case "down": {
      // The side against the parent, which is opposite the way the part faces.
      const [nx, ny, nz] = NORMALS[part.face];
      return [x - (nx * sx) / 2, y - (ny * sy) / 2, z - (nz * sz) / 2];
    }
    case "rear":
      return [x - sx / 2, y, z];
    case "front":
      return [x + sx / 2, y, z];
    default:
      return [x, y, z];
  }
}

export function modelTransform(part: ScenePart, spec: VariantSpec, model: ModelShape): ModelTransform {
  const sideways = (spec.mount === "up" || spec.mount === "down") && (part.face === "right" || part.face === "left");
  // The box's size in the model's own frame: a part on a side stands out along z, not y.
  const target: Vec3 = sideways ? [part.size[0], part.size[2], part.size[1]] : part.size;
  const native = [0, 1, 2].map((axis) => Math.max(model.max[axis] - model.min[axis], 1e-6)) as Vec3;
  const ratios = [0, 1, 2].map((axis) => target[axis] / native[axis]) as Vec3;
  const uniform = Math.min(...ratios);
  const scale: Vec3 = spec.fit === "stretch" ? ratios : [uniform, uniform, uniform];
  const mount = spec.fit === "stretch" ? extentAnchor(spec.mount, model.min, model.max) : model.mount;
  const quaternion = multiply(aroundZ(part.tilt), faceRotation(spec.mount, part.face));
  return {
    position: boxAnchor(part, spec.mount),
    quaternion,
    scale,
    offset: [-mount[0], -mount[1], -mount[2]],
  };
}

/** Applies a transform to a point in the model's frame, for checking placement. */
export function applyTransform(transform: ModelTransform, point: Vec3): Vec3 {
  const local: Vec3 = [0, 1, 2].map((axis) => (point[axis] + transform.offset[axis]) * transform.scale[axis]) as Vec3;
  const [qx, qy, qz, qw] = transform.quaternion;
  const [px, py, pz] = local;
  // v' = v + 2w(q × v) + 2q × (q × v)
  const cx = qy * pz - qz * py;
  const cy = qz * px - qx * pz;
  const cz = qx * py - qy * px;
  const ccx = qy * cz - qz * cy;
  const ccy = qz * cx - qx * cz;
  const ccz = qx * cy - qy * cx;
  return [
    transform.position[0] + px + 2 * (qw * cx + ccx),
    transform.position[1] + py + 2 * (qw * cy + ccy),
    transform.position[2] + pz + 2 * (qw * cz + ccz),
  ];
}
