import type { BuildNode, GunItem, ModSlotDef } from "@/app/lib/types/gunBuilder";
import { isDetailed, type ItemLookup } from "./stats";
import { childAt } from "./tree";

// Turns a build tree into simple 3D shapes for the 3D view.
//
// There are no licensed 3D models of Tarkov items (tarkov.dev serves images only, and the game's
// models belong to Battlestate Games), and the data has no attachment points. So each part becomes
// a box or cylinder sized from its kind, its inventory size, and any length in its name, placed by
// the kind of slot it sits in: barrels and muzzles run forward along the bore, stocks run back,
// magazines and grips hang below, optics and sights sit on top, lights go on the side. It is a
// schematic of the build, not a model of the gun.
//
// Units are roughly centimetres. The bore runs along +x (the muzzle end), y is up, and +z is the
// gun's right side.

export type PartKind =
  | "body"
  | "receiver"
  | "barrel"
  | "muzzle"
  | "gasBlock"
  | "handguard"
  | "stock"
  | "grip"
  | "magazine"
  | "optic"
  | "ironSight"
  | "mount"
  | "tactical"
  | "foregrip"
  | "charge"
  | "launcher"
  | "bipod"
  | "other";

export type Face = "top" | "bottom" | "right" | "left";

export type Vec3 = [number, number, number];

export interface ScenePart {
  /** The part's path joined with "/", "root" for the weapon, or "builtin:…" for a built-in part. */
  id: string;
  kind: PartKind;
  shape: "box" | "cylinder";
  /** The installed item; null for an empty slot or a part built into the weapon. */
  itemId: string | null;
  /** "part" is an installed item, "empty" a required slot with nothing in it, "builtin" part of the weapon itself. */
  role: "part" | "empty" | "builtin";
  path: string[];
  parentPath: string[];
  slotId: string | null;
  slot: ModSlotDef | null;
  parentItemId: string | null;
  center: Vec3;
  /** Extent along x, y, z. A cylinder runs along x, so its y and z are both its diameter. */
  size: Vec3;
  /** Rotation about z in radians; positive swings the lower end forward, as on a curved magazine. */
  tilt: number;
  /** The side of its parent the part sits on. */
  face: Face;
}

export interface BuildScene {
  parts: ScenePart[];
  min: Vec3;
  max: Vec3;
}

type WeaponClass = "pistol" | "smg" | "rifle" | "sniper" | "lmg" | "shotgun";

const BODY: Record<WeaponClass, Vec3> = {
  pistol: [18, 3.2, 2.8],
  smg: [24, 6, 3.6],
  rifle: [26, 6.5, 3.6],
  sniper: [30, 6, 4],
  lmg: [32, 7, 4.4],
  shotgun: [26, 6, 3.8],
};

const DEFAULT_BARREL_CM: Record<WeaponClass, number> = {
  pistol: 11,
  smg: 20,
  rifle: 38,
  sniper: 60,
  lmg: 55,
  shotgun: 50,
};

const BARREL_DIAMETER: Record<WeaponClass, number> = {
  pistol: 1.2,
  smg: 1.5,
  rifle: 1.6,
  sniper: 2,
  lmg: 2,
  shotgun: 2.2,
};

const PISTOL_GRIP: Vec3 = [4.6, 10, 3];

/** The gap between parts packed along one face of their parent. */
const GAP = 0.6;

export function weaponClass(name: string): WeaponClass {
  const lower = name.toLowerCase();
  if (/\bshotgun\b/.test(lower)) return "shotgun";
  if (/\bmachine gun\b/.test(lower) && !/\bsubmachine gun\b/.test(lower)) return "lmg";
  if (/\bsubmachine gun\b/.test(lower)) return "smg";
  if (/\b(sniper|marksman)\b/.test(lower)) return "sniper";
  if (/\bpistol\b/.test(lower) && !/\bpistol grip\b/.test(lower)) return "pistol";
  return "rifle";
}

/** A slot's kind of part, from its name id such as `mod_pistol_grip` or `mod_mount_001`. */
export function slotKind(nameId: string): PartKind {
  const id = nameId.toLowerCase();
  if (id.includes("muzzle")) return "muzzle";
  if (id.includes("barrel")) return "barrel";
  if (id.includes("gas_block") || id.includes("gasblock")) return "gasBlock";
  if (id.includes("handguard")) return "handguard";
  if (id.includes("reciever") || id.includes("receiver")) return "receiver";
  if (id.includes("pistol_grip") || id.includes("pistolgrip")) return "grip";
  if (id.includes("stock")) return "stock";
  if (id.includes("magazine")) return "magazine";
  if (id.includes("scope")) return "optic";
  if (id.includes("sight")) return "ironSight";
  if (id.includes("mount")) return "mount";
  if (id.includes("tactical") || id.includes("flashlight")) return "tactical";
  if (id.includes("foregrip")) return "foregrip";
  if (id.includes("charge")) return "charge";
  if (id.includes("launcher")) return "launcher";
  if (id.includes("bipod")) return "bipod";
  return "other";
}

/** A length written in an item's name, such as "14.5 inch" or "565mm", in centimetres. */
export function lengthFromName(name: string): number | null {
  const inches = /(\d+(?:\.\d+)?)\s*(?:-\s*)?(?:inch|in\b|")/i.exec(name);
  if (inches) {
    const value = Number(inches[1]) * 2.54;
    if (value >= 2 && value <= 120) return value;
  }
  const millimetres = /(\d{2,4})\s*mm\b/i.exec(name);
  if (millimetres) {
    const value = Number(millimetres[1]) / 10;
    if (value >= 2 && value <= 120) return value;
  }
  return null;
}

interface Box {
  min: Vec3;
  max: Vec3;
}

interface Placed {
  part: ScenePart;
  box: Box;
  /** For barrels: where the barrel leaves the receiver, so gas blocks sit just ahead of it. */
  exitX?: number;
}

interface Context {
  lookup: ItemLookup;
  cls: WeaponClass;
  body: Placed;
  builtinBarrel: Placed | null;
  includeEmpty: boolean;
  parts: ScenePart[];
}

function boxOf(center: Vec3, size: Vec3): Box {
  return {
    min: [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2],
    max: [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2],
  };
}

function length(box: Box) {
  return box.max[0] - box.min[0];
}

function isOptic(item: GunItem | undefined) {
  return item?.sight === "optic";
}

function isSuppressor(name: string) {
  return /\b(suppressor|silencer|sound moderator)\b/i.test(name);
}

/** The kind a part is drawn as: its slot's kind, unless the item says otherwise (a reflex sight in a mount slot). */
function partKind(slot: ModSlotDef | null, item: GunItem | undefined): PartKind {
  const fromSlot = slot ? slotKind(slot.nameId) : "other";
  if (isOptic(item) && (fromSlot === "mount" || fromSlot === "other" || fromSlot === "optic")) return "optic";
  // Rails that go in a foregrip slot, such as short M-LOK sections, are drawn as rails.
  if (fromSlot === "foregrip" && /\brail\b/i.test(item?.name ?? "")) return "mount";
  return fromSlot;
}

/** Which side of the parent a part goes on. Mounts spread around their parent by name or order. */
function faceFor(
  kind: PartKind,
  item: GunItem | undefined,
  slotKindOf: PartKind,
  parent: Placed,
  mountIndex: number
): Face {
  switch (kind) {
    case "grip":
    case "magazine":
    case "foregrip":
    case "launcher":
    case "bipod":
      return "bottom";
    case "tactical":
      return parent.part.face === "top" ? "right" : parent.part.face;
    case "charge":
      return "top";
    case "mount": {
      if (parent.part.kind === "mount" || parent.part.kind === "tactical") return parent.part.face;
      const name = item?.name.toLowerCase() ?? "";
      if (slotKindOf === "foregrip") return "bottom";
      if (/\bbottom\b|\blower\b|\bunder/.test(name)) return "bottom";
      if (/\bside\b/.test(name)) return mountIndex % 2 === 0 ? "left" : "right";
      if (/\btop\b|\bupper\b/.test(name)) return "top";
      return (["top", "right", "left", "bottom"] as const)[mountIndex % 4];
    }
    default:
      return parent.part.kind === "mount" || parent.part.kind === "tactical" ? parent.part.face : "top";
  }
}

/** Size of a part on a face: x is along the bore, y is how far it stands out, z is across. */
function faceSize(
  kind: PartKind,
  item: GunItem | undefined,
  slot: ModSlotDef | null,
  parent: Placed,
  cls: WeaponClass
): {
  size: Vec3;
  shape: ScenePart["shape"];
  /** Where along the parent the part would like to sit, 0 at the rear and 1 at the front. */
  at: number;
} {
  const cellsX = (isDetailed(item) && item.gridWidth) || 1;
  const cellsY = (isDetailed(item) && item.gridHeight) || 1;
  const parentLength = length(parent.box);
  switch (kind) {
    case "optic":
      return cellsX >= 2
        ? { size: [12 + (cellsX - 2) * 6, 3.8, 3.8], shape: "cylinder", at: 0.35 }
        : { size: [5.5, 4.6, 3.4], shape: "box", at: 0.4 };
    case "ironSight":
      return {
        size: cls === "pistol" ? [1.2, 0.9, 1.4] : [2, 2.4, 1.6],
        shape: "box",
        at: /front/i.test(slot?.nameId ?? item?.name ?? "") ? 0.95 : 0.1,
      };
    case "mount": {
      const rail = Math.min(Math.max(cellsX * 7, 5), Math.max(parentLength * 0.85, 5));
      return { size: [rail, 1.3, 2.4], shape: "box", at: 0.5 };
    }
    case "tactical":
      return { size: [6, 2.8, 2.8], shape: "box", at: 0.85 };
    case "foregrip":
      return { size: [3, 8, 3], shape: "box", at: 0.65 };
    case "launcher":
      return { size: [24, 5, 5], shape: "cylinder", at: 0.5 };
    case "bipod":
      return { size: [2.5, 10, 6], shape: "box", at: 0.9 };
    case "charge":
      return { size: [4, 1.4, 1.8], shape: "box", at: 0.05 };
    case "magazine":
      return { size: [4 * Math.min(cellsX, 2), Math.max(cellsY, 1) * 7, cellsX > 1 ? 7 : 2.6], shape: "box", at: 0.6 };
    default:
      return { size: [cellsX * 3, cellsY * 2, 2], shape: "box", at: 0.5 };
  }
}

/** Packs parts along one face of their parent, each as near its preferred spot as the others allow. */
function packAlongFace(
  parent: Placed,
  entries: { at: number; length: number }[]
): number[] {
  const rear = parent.box.min[0];
  const span = length(parent.box);
  const order = entries.map((entry, index) => ({ ...entry, index })).toSorted((a, b) => a.at - b.at);
  const centers = new Array<number>(entries.length);
  let cursor = -Infinity;
  for (const entry of order) {
    const wanted = rear + entry.at * span - entry.length / 2;
    const start = Math.max(wanted, cursor);
    centers[entry.index] = start + entry.length / 2;
    cursor = start + entry.length + GAP;
  }
  // Slide the group back if it ran off the front, but never past the rear.
  const overflow = Math.max(0, cursor - GAP - parent.box.max[0]);
  if (overflow > 0) {
    const first = Math.min(...order.map((entry) => centers[entry.index] - entry.length / 2));
    const shift = Math.min(overflow, Math.max(0, first - rear));
    for (let index = 0; index < centers.length; index += 1) centers[index] -= shift;
  }
  return centers;
}

function onFace(parent: Placed, face: Face, x: number, size: Vec3): { center: Vec3; size: Vec3 } {
  const [, outward, across] = size;
  const { min, max } = parent.box;
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;
  switch (face) {
    case "top":
      return { center: [x, max[1] + outward / 2, cz], size: [size[0], outward, across] };
    case "bottom":
      return { center: [x, min[1] - outward / 2, cz], size: [size[0], outward, across] };
    case "right":
      return { center: [x, cy, max[2] + outward / 2], size: [size[0], across, outward] };
    case "left":
      return { center: [x, cy, min[2] - outward / 2], size: [size[0], across, outward] };
  }
}

/** The front of the nearest receiver or body, where barrels and handguards start. */
function receiverFront(chain: Placed[], context: Context) {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const kind = chain[index].part.kind;
    if (kind === "body" || kind === "receiver") return chain[index].box.max[0];
  }
  return context.body.box.max[0];
}

function axialFront(parent: Placed, context: Context) {
  const kind = parent.part.kind;
  if (kind === "barrel" || kind === "muzzle") return parent.box.max[0];
  return context.builtinBarrel?.box.max[0] ?? parent.box.max[0];
}

interface ChildSpec {
  slot: ModSlotDef | null;
  slotId: string;
  child: BuildNode | undefined;
}

function childSpecs(node: BuildNode, item: GunItem | undefined, includeEmpty: boolean): ChildSpec[] {
  if (!isDetailed(item)) {
    return Object.entries(node.slots).map(([slotId, child]) => ({ slot: null, slotId, child }));
  }
  const defined = new Set(item.slots.map((slot) => slot.id));
  return [
    ...item.slots.flatMap((slot) => {
      const child = childAt(node, slot.id);
      if (!child && !(includeEmpty && slot.required)) return [];
      return [{ slot, slotId: slot.id, child }];
    }),
    ...Object.entries(node.slots)
      .filter(([slotId]) => !defined.has(slotId))
      .map(([slotId, child]) => ({ slot: null, slotId, child })),
  ];
}

function makePart(
  spec: ChildSpec,
  parent: Placed,
  path: string[],
  kind: PartKind,
  shape: ScenePart["shape"],
  center: Vec3,
  size: Vec3,
  face: Face,
  tilt = 0
): Placed {
  const part: ScenePart = {
    id: path.join("/"),
    kind,
    shape,
    itemId: spec.child?.itemId ?? null,
    role: spec.child ? "part" : "empty",
    path,
    parentPath: path.slice(0, -1),
    slotId: spec.slotId,
    slot: spec.slot,
    parentItemId: parent.part.itemId,
    center,
    size,
    tilt,
    face,
  };
  return { part, box: boxOf(center, size) };
}

/** Places parts that run along the bore or hang off the body: barrels, muzzles, stocks, grips, magazines. */
function placeStructural(
  spec: ChildSpec,
  kind: PartKind,
  item: GunItem | undefined,
  parent: Placed,
  chain: Placed[],
  path: string[],
  context: Context
): Placed | null {
  const { cls, body } = context;
  const name = item?.name ?? "";
  const cellsX = (isDetailed(item) && item.gridWidth) || 0;
  const cellsY = (isDetailed(item) && item.gridHeight) || 0;
  const bodyBox = body.box;
  const bodyLength = length(bodyBox);

  switch (kind) {
    case "receiver": {
      const host = parent.part.kind === "body" || parent.part.kind === "receiver" ? parent : body;
      const hostLength = length(host.box);
      const hostHeight = host.box.max[1] - host.box.min[1];
      const hostWidth = host.box.max[2] - host.box.min[2];
      const pistol = cls === "pistol" && host.part.kind === "body";
      // A receiver inside a chassis shares its footprint; otherwise it sits on top (a pistol's slide).
      const size: Vec3 =
        host.part.kind === "receiver"
          ? [hostLength * 0.92, hostHeight, hostWidth + 0.3]
          : [pistol ? hostLength + 1 : hostLength * 0.96, pistol ? 2.8 : 2.4, hostWidth * 0.95];
      const front = host.box.max[0] + (pistol ? 0.5 : 0);
      const y =
        host.part.kind === "receiver"
          ? (host.box.min[1] + host.box.max[1]) / 2 + 0.3
          : host.box.max[1] + size[1] / 2 - 0.1;
      return makePart(spec, parent, path, kind, "box", [front - size[0] / 2, y, 0], size, "top");
    }
    case "barrel": {
      const barrel = lengthFromName(name) ?? (cellsX ? cellsX * 10 : DEFAULT_BARREL_CM[cls]);
      const exit = receiverFront(chain, context);
      const inside = cls === "pistol" ? barrel * 0.85 : Math.min(10, barrel * 0.25);
      const diameter = BARREL_DIAMETER[cls];
      const start = exit - inside;
      const placed = makePart(spec, parent, path, kind, "cylinder", [start + barrel / 2, 0, 0], [barrel, diameter, diameter], "top");
      return { ...placed, exitX: exit };
    }
    case "muzzle": {
      const suppressor = isSuppressor(name);
      const muzzleLength = suppressor ? Math.max(cellsX, 2) * 8 : cellsX > 1 ? cellsX * 5 : 5;
      const diameter = suppressor ? 3.6 : 2.4;
      // A suppressor on a brake or adapter slides over it.
      const start =
        suppressor && parent.part.kind === "muzzle"
          ? parent.box.min[0] + 0.5
          : axialFront(parent, context);
      return makePart(spec, parent, path, kind, "cylinder", [start + muzzleLength / 2, 0, 0], [muzzleLength, diameter, diameter], "top");
    }
    case "gasBlock": {
      if (parent.part.kind === "barrel") {
        const visible = parent.box.max[0] - (parent.exitX ?? parent.box.min[0]);
        const x = (parent.exitX ?? parent.box.min[0]) + Math.min(14, visible * 0.45);
        return makePart(spec, parent, path, kind, "box", [x, 0.6, 0], [3, 2.8, 2.4], "top");
      }
      // A gas tube over a built-in barrel, as on Kalashnikovs.
      const start = receiverFront(chain, context);
      const reach = context.builtinBarrel ? length(context.builtinBarrel.box) * 0.5 : 18;
      return makePart(spec, parent, path, kind, "cylinder", [start + reach / 2, 1.6, 0], [reach, 1.6, 1.6], "top");
    }
    case "handguard": {
      const stacked = parent.part.kind === "handguard";
      const start = stacked ? parent.box.min[0] : receiverFront(chain, context);
      const guard = stacked
        ? length(parent.box)
        : lengthFromName(name) ?? (cellsX ? Math.max(cellsX * 8, 12) : 20);
      const size: Vec3 = stacked ? [guard, 2.6, 4.6] : [guard, 4.6, 4.2];
      const y = stacked ? parent.box.min[1] + 0.9 : 0;
      return makePart(spec, parent, path, kind, "box", [start + guard / 2, y, 0], size, "top");
    }
    case "stock": {
      const fromStock = parent.part.kind === "stock";
      const tube = /\b(buffer tube|tube|adapter)\b/i.test(name);
      const stockLength = tube ? Math.max(cellsX, 2) * 8 : cellsX ? Math.min(cellsX * 9 + 4, 34) : 22;
      const rear = fromStock ? parent.box.min[0] + (parent.part.shape === "cylinder" ? length(parent.box) * 0.55 : 0.5) : bodyBox.min[0] + 0.5;
      if (tube) {
        return makePart(spec, parent, path, kind, "cylinder", [rear - stockLength / 2, 0, 0], [stockLength, 2.8, 2.8], "top");
      }
      const height = fromStock && parent.part.shape !== "cylinder" ? 7 : 8;
      return makePart(spec, parent, path, kind, "box", [rear - stockLength / 2, -1.8, 0], [stockLength, height, 3.4], "top");
    }
    case "grip": {
      const size: Vec3 = cls === "pistol" ? PISTOL_GRIP : [3.2, 9, 2.8];
      const x = bodyBox.min[0] + bodyLength * (cls === "pistol" ? 0.3 : 0.28);
      return makePart(spec, parent, path, kind, "box", [x, bodyBox.min[1] - size[1] / 2 + 1, 0], size, "bottom", -0.3);
    }
    case "magazine": {
      const capacity = item?.capacity ?? null;
      if (cls === "shotgun" && /\b(shell|tube)\b/i.test(name)) {
        const tubeLength = Math.min(Math.max((capacity ?? 5) * 6, 14), 60);
        const start = bodyBox.max[0] - 4;
        return makePart(spec, parent, path, kind, "cylinder", [start + tubeLength / 2, -2.6, 0], [tubeLength, 2.4, 2.4], "bottom");
      }
      if (cls === "pistol") {
        const x = bodyBox.min[0] + bodyLength * 0.3;
        const size: Vec3 = [3, 11, 2.2];
        return makePart(spec, parent, path, kind, "box", [x - 0.6, bodyBox.min[1] - size[1] / 2 + 0.5, 0], size, "bottom", -0.3);
      }
      const height = cellsY ? cellsY * 7 : capacity ? Math.min(Math.max(6 + capacity * 0.35, 6), 28) : 14;
      const wide = cellsX > 1;
      const size: Vec3 = [wide ? 8 : 4, height, wide ? 7 : 2.6];
      const x = bodyBox.min[0] + bodyLength * 0.62;
      return makePart(spec, parent, path, kind, "box", [x, bodyBox.min[1] - size[1] / 2 + 1, 0], size, "bottom", wide ? 0 : 0.12);
    }
    default:
      return null;
  }
}

function placeChildren(node: BuildNode, placed: Placed, chain: Placed[], context: Context) {
  const item = context.lookup.get(node.itemId);
  const specs = childSpecs(node, item, context.includeEmpty);
  const faceEntries: {
    spec: ChildSpec;
    kind: PartKind;
    item: GunItem | undefined;
    face: Face;
    size: Vec3;
    shape: ScenePart["shape"];
    at: number;
  }[] = [];
  const structural: { spec: ChildSpec; placed: Placed }[] = [];
  let mountIndex = 0;
  const nextChain = [...chain, placed];

  for (const spec of specs) {
    const childItem = spec.child ? context.lookup.get(spec.child.itemId) : undefined;
    const kind = partKind(spec.slot, childItem);
    const path = [...placed.part.path, spec.slotId];
    const result = placeStructural(spec, kind, childItem, placed, nextChain, path, context);
    if (result) {
      structural.push({ spec, placed: result });
      continue;
    }
    const fromSlot = spec.slot ? slotKind(spec.slot.nameId) : "other";
    const face = faceFor(kind, childItem, fromSlot, placed, kind === "mount" ? mountIndex++ : 0);
    const { size, shape, at } = faceSize(kind, childItem, spec.slot, placed, context.cls);
    faceEntries.push({ spec, kind, item: childItem, face, size, shape, at });
  }

  // Parts on top of a gun or receiver sit on whatever receiver covers it, not inside it.
  const covers = structural.filter((entry) => entry.placed.part.kind === "receiver").map((entry) => entry.placed.box.max[1]);
  // Parts under a receiver hang below the gun's body, which the receiver sits on.
  const top = Math.max(placed.box.max[1], ...covers);
  const bottom = placed.part.kind === "receiver" ? Math.min(placed.box.min[1], context.body.box.min[1]) : placed.box.min[1];
  const host: Placed = {
    ...placed,
    box: { min: [placed.box.min[0], bottom, placed.box.min[2]], max: [placed.box.max[0], top, placed.box.max[2]] },
  };

  const faced: { spec: ChildSpec; placed: Placed }[] = [];
  for (const face of ["top", "bottom", "right", "left"] as const) {
    const group = faceEntries.filter((entry) => entry.face === face);
    if (group.length === 0) continue;
    const centers = packAlongFace(
      host,
      group.map((entry) => ({ at: entry.at, length: entry.size[0] }))
    );
    group.forEach((entry, index) => {
      const { center, size } = onFace(host, face, centers[index], entry.size);
      const path = [...placed.part.path, entry.spec.slotId];
      faced.push({
        spec: entry.spec,
        placed: makePart(entry.spec, placed, path, entry.kind, entry.shape, center, size, face),
      });
    });
  }

  for (const { spec, placed: child } of [...structural, ...faced]) {
    context.parts.push(child.part);
    if (spec.child) placeChildren(spec.child, child, nextChain, context);
  }
}

/** Whether the weapon's barrel is part of the gun itself: muzzle or handguard slots but no barrel slot anywhere. */
function hasBuiltinBarrel(root: BuildNode, lookup: ItemLookup) {
  let barrelSlot = false;
  let axisSlot = false;
  // Only the gun and its receivers count for axis slots: a muzzle slot on a barrel says nothing.
  const stack: { node: BuildNode; host: boolean }[] = [{ node: root, host: true }];
  while (stack.length > 0) {
    const { node, host } = stack.pop()!;
    const item = lookup.get(node.itemId);
    if (!isDetailed(item)) continue;
    for (const slot of item.slots) {
      const kind = slotKind(slot.nameId);
      if (kind === "barrel") barrelSlot = true;
      if (host && (kind === "muzzle" || kind === "handguard" || kind === "gasBlock")) axisSlot = true;
      const child = childAt(node, slot.id);
      if (child) stack.push({ node: child, host: kind === "receiver" });
    }
  }
  return axisSlot && !barrelSlot;
}

export interface BuildSceneOptions {
  /** Show required slots with nothing in them as outlines. Defaults to true. */
  includeEmptyRequired?: boolean;
}

export function buildScene(root: BuildNode, lookup: ItemLookup, options: BuildSceneOptions = {}): BuildScene {
  const weapon = lookup.get(root.itemId);
  const cls = weaponClass(weapon?.name ?? "");
  const bodySize = BODY[cls];
  // The bore (y = 0) runs through a long gun's body, and through a pistol's slide above its frame.
  const bodyTop = cls === "pistol" ? -1.3 : 1.6;
  const bodyCenter: Vec3 = [0, bodyTop - bodySize[1] / 2, 0];
  const bodyPart: ScenePart = {
    id: "root",
    kind: "body",
    shape: "box",
    itemId: root.itemId,
    role: "part",
    path: [],
    parentPath: [],
    slotId: null,
    slot: null,
    parentItemId: null,
    center: bodyCenter,
    size: bodySize,
    tilt: 0,
    face: "top",
  };
  const body: Placed = { part: bodyPart, box: boxOf(bodyCenter, bodySize) };
  const parts: ScenePart[] = [bodyPart];

  let builtinBarrel: Placed | null = null;
  if (hasBuiltinBarrel(root, lookup)) {
    const barrel = DEFAULT_BARREL_CM[cls] * 0.8;
    const diameter = BARREL_DIAMETER[cls];
    const center: Vec3 = [body.box.max[0] + barrel / 2, 0, 0];
    const size: Vec3 = [barrel, diameter, diameter];
    builtinBarrel = {
      part: { ...bodyPart, id: "builtin:barrel", kind: "barrel", shape: "cylinder", itemId: null, role: "builtin", center, size },
      box: boxOf(center, size),
    };
    parts.push(builtinBarrel.part);
  }
  if (cls === "pistol" && !hasGripInstalled(root, weapon)) {
    // A pistol's frame is its grip.
    const size = PISTOL_GRIP;
    const center: Vec3 = [body.box.min[0] + length(body.box) * 0.3, body.box.min[1] - size[1] / 2 + 1, 0];
    parts.push({ ...bodyPart, id: "builtin:grip", kind: "grip", itemId: null, role: "builtin", center, size, tilt: -0.3, face: "bottom" });
  }

  const context: Context = {
    lookup,
    cls,
    body,
    builtinBarrel,
    includeEmpty: options.includeEmptyRequired ?? true,
    parts,
  };
  placeChildren(root, body, [], context);
  return { parts, ...sceneBounds(parts) };
}

function hasGripInstalled(root: BuildNode, weapon: GunItem | undefined) {
  return isDetailed(weapon) && weapon.slots.some((slot) => slotKind(slot.nameId) === "grip" && childAt(root, slot.id));
}

export function sceneBounds(parts: readonly ScenePart[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    // A tilted part's corners can reach past its upright box by up to half its larger side.
    const slack = part.tilt ? Math.max(part.size[0], part.size[1]) * Math.abs(Math.sin(part.tilt)) / 2 : 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const pad = axis < 2 ? slack : 0;
      min[axis] = Math.min(min[axis], part.center[axis] - part.size[axis] / 2 - pad);
      max[axis] = Math.max(max[axis], part.center[axis] + part.size[axis] / 2 + pad);
    }
  }
  if (parts.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}
