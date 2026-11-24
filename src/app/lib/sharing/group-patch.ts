/**
 * Item groups change through patches: a rename, and sets of items added and removed. Items merge
 * per item and never clash (an item added and removed at once ends as the server applied them
 * last); only two renames of the same group clash.
 */
export interface GroupContent {
  name: string;
  items: string[];
}

export interface GroupPatch {
  name?: string;
  add?: string[];
  remove?: string[];
}

export function diffGroup(before: GroupContent, after: GroupContent): GroupPatch | null {
  const patch: GroupPatch = {};
  if (before.name !== after.name) patch.name = after.name;
  const old = new Set(before.items);
  const now = new Set(after.items);
  const add = after.items.filter((item) => !old.has(item));
  const remove = before.items.filter((item) => !now.has(item));
  if (add.length > 0) patch.add = add;
  if (remove.length > 0) patch.remove = remove;
  return Object.keys(patch).length > 0 ? patch : null;
}

export function applyGroupPatch<T extends GroupContent>(group: T, patch: GroupPatch): T {
  const removed = new Set(patch.remove ?? []);
  const items = group.items.filter((item) => !removed.has(item));
  for (const item of patch.add ?? []) if (!items.includes(item)) items.push(item);
  return { ...group, name: patch.name ?? group.name, items };
}

export function groupPatchFields(patch: GroupPatch): string[] {
  const fields = patch.name !== undefined ? ["name"] : [];
  for (const item of [...(patch.add ?? []), ...(patch.remove ?? [])]) fields.push(`item:${item}`);
  return [...new Set(fields)];
}

/** Only renames clash. */
export function clashingGroupFields(patch: GroupPatch, fieldVersions: Record<string, number>, baseVersion: number): string[] {
  return patch.name !== undefined && (fieldVersions.name ?? 0) > baseVersion ? ["name"] : [];
}

export function nextGroupFieldVersions(fieldVersions: Record<string, number>, patch: GroupPatch, version: number, items: readonly string[]) {
  const next: Record<string, number> = {};
  const present = new Set(items);
  for (const [key, value] of Object.entries(fieldVersions)) {
    if (key === "name" || present.has(key.slice(5))) next[key] = value;
  }
  for (const field of groupPatchFields(patch)) if (field === "name" || present.has(field.slice(5))) next[field] = version;
  return next;
}

export function initialGroupFieldVersions(group: GroupContent): Record<string, number> {
  const fields: Record<string, number> = { name: 1 };
  for (const item of group.items) fields[`item:${item}`] = 1;
  return fields;
}

export function omitGroupFields(patch: GroupPatch, fields: readonly string[]): GroupPatch | null {
  const next: GroupPatch = { ...patch };
  if (fields.includes("name")) delete next.name;
  return Object.keys(next).length > 0 ? next : null;
}

export function foldGroupPatches(first: GroupPatch, second: GroupPatch): GroupPatch {
  const add = new Set(first.add ?? []);
  const remove = new Set(first.remove ?? []);
  for (const item of second.remove ?? []) {
    add.delete(item);
    remove.add(item);
  }
  for (const item of second.add ?? []) {
    remove.delete(item);
    add.add(item);
  }
  const folded: GroupPatch = {};
  const name = second.name ?? first.name;
  if (name !== undefined) folded.name = name;
  if (add.size > 0) folded.add = [...add];
  if (remove.size > 0) folded.remove = [...remove];
  return folded;
}

/** "Name", then "Name (2)", "Name (3)"…: the first that isn't taken, within the length limit. */
export function uniqueGroupName(name: string, taken: (key: string) => boolean, maxLength: number, suffix?: string): string {
  const first = suffix ? `${name.slice(0, maxLength - suffix.length - 1)} ${suffix}` : name;
  if (!taken(first.toLowerCase())) return first;
  for (let index = 2; index < 1000; index += 1) {
    const tail = ` (${index})`;
    const candidate = `${first.slice(0, maxLength - tail.length)}${tail}`;
    if (!taken(candidate.toLowerCase())) return candidate;
  }
  throw new Error("No free group name.");
}
