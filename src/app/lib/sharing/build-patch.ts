import type { BuildNode } from "@/app/lib/types/gunBuilder";

/**
 * Builds change through patches that name only what changed, so edits from two devices to
 * different parts of a gun merge without asking. A slot path is the slot ids from the weapon down,
 * joined with "/". A patch entry sets the part in that slot (null empties it); setting a part
 * clears what was mounted on it, so a patch carries the whole new subtree of every slot it changes.
 */
export type SlotPath = string;

export interface BuildContent {
  name: string;
  weaponId: string;
  root: BuildNode;
  ammoId?: string;
}

export interface BuildPatch {
  name?: string;
  ammoId?: string | null;
  slots?: Record<SlotPath, string | null>;
}

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

function joinPath(parent: string, slot: string) {
  return parent ? `${parent}/${slot}` : slot;
}

function depth(path: SlotPath) {
  return path.split("/").length;
}

function addSubtree(slots: Record<SlotPath, string | null>, path: SlotPath, node: BuildNode) {
  slots[path] = node.itemId;
  for (const [slot, child] of Object.entries(node.slots)) addSubtree(slots, joinPath(path, slot), child);
}

/** The patch that turns `before` into `after`, or null when they are the same. */
export function diffBuild(before: BuildContent, after: BuildContent): BuildPatch | null {
  const patch: BuildPatch = {};
  if (before.name !== after.name) patch.name = after.name;
  if ((before.ammoId ?? null) !== (after.ammoId ?? null)) patch.ammoId = after.ammoId ?? null;
  const slots: Record<SlotPath, string | null> = {};
  const walk = (path: SlotPath, a: BuildNode, b: BuildNode) => {
    for (const slot of new Set([...Object.keys(a.slots), ...Object.keys(b.slots)])) {
      const childPath = joinPath(path, slot);
      const left = a.slots[slot];
      const right = b.slots[slot];
      if (!right) slots[childPath] = null;
      else if (!left || left.itemId !== right.itemId) addSubtree(slots, childPath, right);
      else walk(childPath, left, right);
    }
  };
  walk("", before.root, after.root);
  if (Object.keys(slots).length > 0) patch.slots = slots;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Applies a patch to a copy of the build. Throws PatchError if a slot's parent isn't there. */
export function applyBuildPatch<T extends BuildContent>(build: T, patch: BuildPatch): T {
  const next: T = { ...build, root: structuredClone(build.root) };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.ammoId !== undefined) {
    if (patch.ammoId === null) delete next.ammoId;
    else next.ammoId = patch.ammoId;
  }
  const entries = Object.entries(patch.slots ?? {}).sort(([a], [b]) => depth(a) - depth(b) || a.localeCompare(b));
  for (const [path, itemId] of entries) {
    const segments = path.split("/");
    const slot = segments.pop()!;
    let parent: BuildNode | undefined = next.root;
    for (const segment of segments) parent = parent?.slots[segment];
    if (!parent) {
      if (itemId === null) continue;
      throw new PatchError(`Slot ${path} has nothing to mount on.`);
    }
    if (itemId === null) delete parent.slots[slot];
    else parent.slots[slot] = { itemId, slots: {} };
  }
  return next;
}

/** The field keys a patch touches, for field_versions. */
export function buildPatchFields(patch: BuildPatch): string[] {
  const fields: string[] = [];
  if (patch.name !== undefined) fields.push("name");
  if (patch.ammoId !== undefined) fields.push("ammo");
  for (const path of Object.keys(patch.slots ?? {})) fields.push(`slot:${path}`);
  return fields;
}

function related(a: string, b: string) {
  if (a === b) return true;
  if (!a.startsWith("slot:") || !b.startsWith("slot:")) return false;
  const left = a.slice(5);
  const right = b.slice(5);
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

/**
 * The patch's fields that clash with fields changed after `baseVersion`. A slot clashes with a
 * change to itself, to any slot above it, and to any slot below it.
 */
export function clashingBuildFields(patch: BuildPatch, fieldVersions: Record<string, number>, baseVersion: number): string[] {
  const changed = Object.entries(fieldVersions)
    .filter(([, version]) => version > baseVersion)
    .map(([field]) => field);
  return buildPatchFields(patch).filter((field) => changed.some((other) => related(field, other)));
}

/**
 * New field versions after a patch at `version`: touched fields get it, and the old entries of
 * slots below a replaced or emptied slot are dropped, so the map stays bounded by the build.
 */
export function nextBuildFieldVersions(fieldVersions: Record<string, number>, patch: BuildPatch, version: number): Record<string, number> {
  const next: Record<string, number> = { ...fieldVersions };
  const paths = Object.keys(patch.slots ?? {});
  for (const key of Object.keys(next)) {
    if (key.startsWith("slot:") && paths.some((path) => key.startsWith(`slot:${path}/`))) delete next[key];
  }
  for (const field of buildPatchFields(patch)) next[field] = version;
  return next;
}

/** Field versions for a new build: every field starts at version 1. */
export function initialBuildFieldVersions(build: BuildContent): Record<string, number> {
  const slots: Record<SlotPath, string | null> = {};
  for (const [slot, child] of Object.entries(build.root.slots)) addSubtree(slots, slot, child);
  const fields: Record<string, number> = { name: 1, ammo: 1 };
  for (const path of Object.keys(slots)) fields[`slot:${path}`] = 1;
  return fields;
}

/** Only the patch entries for the given fields, or null when none are left. */
export function pickBuildFields(patch: BuildPatch, fields: readonly string[]): BuildPatch | null {
  const keep = new Set(fields);
  const picked: BuildPatch = {};
  if (patch.name !== undefined && keep.has("name")) picked.name = patch.name;
  if (patch.ammoId !== undefined && keep.has("ammo")) picked.ammoId = patch.ammoId;
  const slots = Object.fromEntries(Object.entries(patch.slots ?? {}).filter(([path]) => keep.has(`slot:${path}`)));
  if (Object.keys(slots).length > 0) picked.slots = slots;
  return Object.keys(picked).length > 0 ? picked : null;
}

/** The patch without the given fields, or null when nothing is left. */
export function omitBuildFields(patch: BuildPatch, fields: readonly string[]): BuildPatch | null {
  const all = buildPatchFields(patch);
  const drop = new Set(fields);
  return pickBuildFields(
    patch,
    all.filter((field) => !drop.has(field))
  );
}

/** Folds two patches made one after the other into one: the later value of each field wins. */
export function foldBuildPatches(first: BuildPatch, second: BuildPatch): BuildPatch {
  const folded: BuildPatch = { ...first, ...second };
  if (first.slots || second.slots) {
    const slots: Record<SlotPath, string | null> = { ...first.slots };
    for (const [path, item] of Object.entries(second.slots ?? {})) {
      // A later change to a slot replaces what the earlier patch put below it.
      for (const key of Object.keys(slots)) if (key.startsWith(`${path}/`)) delete slots[key];
      slots[path] = item;
    }
    folded.slots = slots;
  }
  return folded;
}
