import type {
  AmmoItemData,
  BuildItemData,
  BuildNode,
  GunListItem,
  ModSlotDef,
  PresetContents,
} from "@/app/lib/types/gunBuilder";
import type { CatalogItem } from "@/app/lib/cache/types";
import type { GameMode } from "@/components/game-mode/mode";
import { InputError } from "@/app/lib/input-error";
import { indexItems, matchItemReference } from "@/app/lib/search/item-reference";
import { normalizeText } from "@/app/lib/search/normalize-text";
import { ammoFits, ammoOptions } from "./ammo";
import { slotKey } from "./compare";
import { reconstructPresetTree } from "./presets";
import { parseSharedBuildInput, ShareImportError } from "./share-import";
import { isDetailed } from "./stats";
import { conflictReason, installedOutside } from "./conflicts";
import { attachMod, carryOverChildren, childAt } from "./tree";

export type PartLookup = ReadonlyMap<string, BuildItemData>;

/** The data needed to turn a build description into a tree. Loaders fetch on demand. */
export interface BuildSource {
  gameMode: GameMode;
  lookup: PartLookup;
  guns: readonly GunListItem[];
  loadPreset(id: string): Promise<PresetContents | null>;
  loadAmmo(ids: readonly string[]): Promise<AmmoItemData[]>;
}

/** A part to install: the slot path from the weapon down, and a part id or name. */
interface PartInput {
  slotPath: readonly string[];
  item: string;
}

/** A build given as a share link, or a weapon with an optional preset and parts. */
export interface BuildInput {
  shareLink?: string;
  weapon?: string;
  preset?: string;
  parts?: readonly PartInput[];
  ammo?: string;
  name?: string;
}

export interface ResolvedBuild {
  name: string;
  weaponId: string;
  root: BuildNode;
  ammoId: string | null;
  warnings: string[];
}

class AmbiguousReferenceError extends InputError {}

export function asCatalog(items: readonly { id: string; name: string; shortName: string | null }[]): CatalogItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    shortName: item.shortName,
    normalizedName: null,
    gridImageLink: null,
  }));
}

/**
 * Picks a candidate the way item names resolve everywhere else (matchItemReference): id,
 * exact name, unique short name, then search with typo tolerance. A name several candidates
 * share equally is ambiguous and throws with the candidates instead of taking the first.
 * Inexact matches add a note saying what was assumed.
 */
function pickByReference<T extends { id: string; name: string; shortName: string | null }>(
  candidates: readonly T[],
  reference: string,
  noun: string,
  notes?: string[]
): T {
  const match = matchItemReference(indexItems(asCatalog(candidates)), reference);
  if (match.status === "ambiguous") {
    throw new AmbiguousReferenceError(
      `"${reference}" matches several ${noun}s: ${match.candidates.join("; ")}. Use a full name or id.`
    );
  }
  if (match.status === "none") {
    throw new InputError(
      `No ${noun} matches "${reference}".${match.suggestions.length ? ` Did you mean: ${match.suggestions.join("; ")}?` : ""}`
    );
  }
  const picked = candidates.find((candidate) => candidate.id === match.item.id)!;
  if (notes && (match.matchedBy === "search" || match.matchedBy === "fuzzy" || match.assumed)) {
    notes.push(
      match.assumed ??
        `"${reference}" was read as ${picked.name}${match.matchedBy === "fuzzy" ? " (closest spelling)" : " (best search match)"}.`
    );
  }
  return picked;
}

export function resolveWeapon(
  source: Pick<BuildSource, "guns" | "lookup">,
  reference: string,
  notes?: string[]
): BuildItemData {
  const gun = pickByReference(source.guns, reference, "weapon", notes);
  const item = source.lookup.get(gun.id);
  if (!isDetailed(item)) throw new InputError(`Weapon data for ${gun.name} is unavailable.`);
  return item;
}

/** "Upper receiver / Muzzle" for a path of slot ids. */
export function slotLabel(root: BuildNode, lookup: PartLookup, path: readonly string[]) {
  const labels: string[] = [];
  let node: BuildNode | undefined = root;
  for (const slotId of path) {
    const item: BuildItemData | undefined = node ? lookup.get(node.itemId) : undefined;
    labels.push(item?.slots.find((slot) => slot.id === slotId)?.name ?? slotId);
    node = node ? childAt(node, slotId) : undefined;
  }
  return labels.join(" / ");
}

export function itemName(lookup: PartLookup, id: string | null) {
  if (!id) return null;
  return lookup.get(id)?.name ?? `Unknown item (${id})`;
}

/** Unknown items, unknown slots, and parts in slots that don't accept them. */
function treeProblems(root: BuildNode, lookup: PartLookup): string[] {
  const problems: string[] = [];
  const walk = (node: BuildNode, path: string[]) => {
    const item = lookup.get(node.itemId);
    if (!item) {
      problems.push(`${path.length ? slotLabel(root, lookup, path) : "Weapon"}: unknown item id ${node.itemId}.`);
      return;
    }
    for (const [slotId, child] of Object.entries(node.slots)) {
      const childPath = [...path, slotId];
      const slot = item.slots.find((candidate) => candidate.id === slotId);
      if (!slot) {
        problems.push(`${item.name} has no slot with id ${slotId}.`);
        continue;
      }
      if (!lookup.has(child.itemId)) {
        problems.push(`${slotLabel(root, lookup, childPath)}: ${child.itemId} is not a known weapon part.`);
        continue;
      }
      if (!slot.allowedItemIds.includes(child.itemId)) {
        problems.push(`${slotLabel(root, lookup, childPath)} does not accept ${itemName(lookup, child.itemId)}.`);
      }
      walk(child, childPath);
    }
  };
  walk(root, []);
  return problems;
}

/** The slots of a part matching a segment by id, name id, or name, most exact first. */
function slotMatches(item: BuildItemData, segment: string): ModSlotDef[] {
  const value = segment.trim();
  const byId = item.slots.filter((slot) => slot.id === value);
  if (byId.length) return byId;
  const needle = normalizeText(value);
  const tiers = [
    item.slots.filter((slot) => normalizeText(slot.nameId) === needle),
    item.slots.filter((slot) => normalizeText(slot.name) === needle),
    item.slots.filter((slot) => slotKey(slot.nameId) === slotKey(needle)),
  ];
  return tiers.find((matches) => matches.length > 0) ?? [];
}

interface ResolvedSlot {
  parentPath: string[];
  parent: BuildNode;
  slot: ModSlotDef;
  current: BuildNode | undefined;
}

type SlotHit = Omit<ResolvedSlot, "current">;

/** Matching slots on parts installed below a node, so a nested slot can be named alone. */
function nestedSlotMatches(node: BuildNode, path: string[], lookup: PartLookup, segment: string): SlotHit[] {
  const hits: SlotHit[] = [];
  const walk = (parent: BuildNode, parentPath: string[]) => {
    const item = lookup.get(parent.itemId);
    if (!isDetailed(item)) return;
    if (parent !== node) hits.push(...slotMatches(item, segment).map((slot) => ({ parentPath, parent, slot })));
    for (const slot of item.slots) {
      const child = childAt(parent, slot.id);
      if (child) walk(child, [...parentPath, slot.id]);
    }
  };
  walk(node, path);
  return hits;
}

const MAX_LISTED_SLOTS = 40;

/** Every slot of the installed parts, as name paths, for error messages. */
function slotTree(root: BuildNode, lookup: PartLookup) {
  const labels: string[] = [];
  const walk = (node: BuildNode, path: string[]) => {
    for (const slot of lookup.get(node.itemId)?.slots ?? []) {
      const childPath = [...path, slot.id];
      const child = childAt(node, slot.id);
      labels.push(`${slotLabel(root, lookup, childPath)}${child ? "" : " (empty)"}`);
      if (child) walk(child, childPath);
    }
  };
  walk(root, []);
  return labels.length > MAX_LISTED_SLOTS ? [...labels.slice(0, MAX_LISTED_SLOTS), "…"] : labels;
}

/**
 * Follows slot ids, name ids, or names from the weapon down to a slot. A segment that names
 * no slot at its level may name one slot on the parts installed below it.
 */
export function resolveSlotPath(root: BuildNode, lookup: PartLookup, segments: readonly string[]): ResolvedSlot {
  if (segments.length === 0) throw new InputError("slotPath needs at least one slot.");
  let node = root;
  let parentPath: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const item = lookup.get(node.itemId);
    if (!isDetailed(item)) throw new InputError(`Part data for ${node.itemId} is unavailable.`);
    const matches = slotMatches(item, segment);
    if (matches.length > 1) {
      throw new InputError(
        `"${segment}" matches several slots on ${item.name}: ${matches
          .map((slot) => `${slot.name} (id ${slot.id})`)
          .join(", ")}. Use the slot id.`
      );
    }
    let hit: SlotHit | undefined = matches[0] && { parentPath, parent: node, slot: matches[0] };
    if (!hit) {
      const nested = nestedSlotMatches(node, parentPath, lookup, segment);
      if (nested.length > 1) {
        throw new InputError(
          `"${segment}" matches several slots: ${nested
            .map((entry) => `${slotLabel(root, lookup, [...entry.parentPath, entry.slot.id])} (slotPath ${JSON.stringify([...entry.parentPath, entry.slot.id])})`)
            .join("; ")}. Give the full slotPath.`
        );
      }
      hit = nested[0];
    }
    if (!hit) {
      throw new InputError(
        `${item.name} has no slot "${segment}", and no installed part below it has one. Its slots are: ${
          item.slots.map((slot) => `${slot.name} (${slot.nameId}, id ${slot.id})`).join(", ") || "none"
        }. Slots in this build: ${slotTree(root, lookup).join("; ") || "none"}.`
      );
    }
    ({ parentPath, parent: node } = hit);
    const child = childAt(node, hit.slot.id);
    if (index === segments.length - 1) return { parentPath, parent: node, slot: hit.slot, current: child };
    if (!child) {
      throw new InputError(
        `${slotLabel(root, lookup, [...parentPath, hit.slot.id])} is empty, so it has no slot "${segments[index + 1]}". Install a part there first.`
      );
    }
    parentPath = [...parentPath, hit.slot.id];
    node = child;
  }
  throw new InputError("slotPath could not be resolved.");
}

function pickPartForSlot(slot: ModSlotDef, lookup: PartLookup, reference: string, notes?: string[]): BuildItemData {
  const allowed = slot.allowedItemIds.flatMap((id) => {
    const item = lookup.get(id);
    return item ? [item] : [];
  });
  if (allowed.length === 0) throw new InputError(`No parts are known for ${slot.name}.`);
  try {
    return pickByReference(allowed, reference, `part for ${slot.name}`, notes);
  } catch (error) {
    if (!(error instanceof InputError) || error instanceof AmbiguousReferenceError) throw error;
    const examples = allowed
      .slice(0, 15)
      .map((item) => item.name)
      .join("; ");
    throw new InputError(
      `${slot.name} does not accept "${reference}". Use get_slot_options to list compatible parts. Examples: ${examples}${allowed.length > 15 ? "; …" : ""}.`
    );
  }
}

/** Finds ammo by id or name, preferring ammo the build accepts. */
export async function resolveAmmo(
  source: BuildSource,
  root: BuildNode,
  reference: string
): Promise<{ ammo: AmmoItemData; fits: boolean; note?: string }> {
  const options = ammoOptions(root, source.lookup);
  const ammo = await source.loadAmmo(options.ids);
  const value = reference.trim();
  if (!options.ids.includes(value)) {
    const outside = await source.loadAmmo([value]);
    if (outside.length > 0) return { ammo: outside[0], fits: false };
  }
  if (ammo.length === 0) throw new InputError("This build does not accept any known ammo.");
  try {
    const notes: string[] = [];
    const picked = pickByReference(ammo, value, "compatible ammo", notes);
    return { ammo: picked, fits: ammoFits(picked.id, options), ...(notes.length ? { note: notes[0] } : {}) };
  } catch (error) {
    if (error instanceof InputError && !(error instanceof AmbiguousReferenceError)) {
      throw new InputError(`${error.message} Use get_ammo_options to list the ammo this build accepts.`);
    }
    throw error;
  }
}

interface InstalledPart {
  root: BuildNode;
  part: BuildItemData;
  label: string;
  replaced: BuildNode | undefined;
  conflict: string | null;
  /** Set when the part name was not an exact match: what it was read as. */
  note?: string;
}

/**
 * Installs a part in a slot, replacing what is there and carrying its attachments over where
 * they fit, as the builder does. Reports a conflict with other installed parts, if any.
 */
export function installPart(root: BuildNode, lookup: PartLookup, slotPath: readonly string[], item: string): InstalledPart {
  const target = resolveSlotPath(root, lookup, slotPath);
  const notes: string[] = [];
  const part = pickPartForSlot(target.slot, lookup, item, notes);
  const conflict = conflictReason(part, target.slot.id, installedOutside(root, target.current), lookup);
  const node = target.current
    ? carryOverChildren(target.current, lookup.get(target.current.itemId), part)
    : { itemId: part.id, slots: {} };
  return {
    root: attachMod(root, target.parentPath, target.slot.id, node),
    part,
    label: slotLabel(root, lookup, [...target.parentPath, target.slot.id]),
    replaced: target.current,
    conflict,
    ...(notes.length ? { note: notes[0] } : {}),
  };
}

function findPresetId(weapon: BuildItemData, wanted: string) {
  const needle = normalizeText(wanted);
  if (needle === "default") return weapon.defaultPresetId ?? undefined;
  const presets = weapon.presets ?? [];
  const exact = presets.find((preset) => preset.id === wanted.trim() || normalizeText(preset.name) === needle);
  if (exact) return exact.id;
  const partial = presets.filter((preset) => normalizeText(preset.name).includes(needle));
  if (partial.length > 1) {
    throw new AmbiguousReferenceError(
      `"${wanted}" matches several ${weapon.name} presets: ${partial.map((preset) => preset.name).join("; ")}. Use the full preset name or "default".`
    );
  }
  return partial[0]?.id;
}

/** Turns a share link, or a weapon and preset, into a checked build tree. */
export async function resolveBuild(source: BuildSource, input: BuildInput): Promise<ResolvedBuild> {
  const warnings: string[] = [];
  let name = input.name?.trim() ?? "";
  let root: BuildNode;
  let ammoId: string | null = null;

  if (input.shareLink) {
    let decoded;
    try {
      decoded = await parseSharedBuildInput(input.shareLink);
    } catch (error) {
      throw new InputError(error instanceof ShareImportError ? error.message : "That share link could not be read.");
    }
    root = decoded.root;
    ammoId = decoded.ammoId;
    name ||= decoded.name;
  } else if (input.weapon) {
    const weapon = resolveWeapon(source, input.weapon, warnings);
    root = { itemId: weapon.id, slots: {} };
    if (input.preset) {
      const presetId = findPresetId(weapon, input.preset);
      if (!presetId) {
        const names = (weapon.presets ?? []).map((preset) => preset.name).join("; ");
        throw new InputError(
          `${weapon.name} has no preset "${input.preset}".${names ? ` Its presets are: ${names}.` : " It has no presets."}`
        );
      }
      const contents = await source.loadPreset(presetId);
      if (!contents) throw new InputError("That preset's contents are unavailable.");
      root = reconstructPresetTree(weapon.id, contents, source.lookup);
      name ||= weapon.presets?.find((preset) => preset.id === presetId)?.name ?? "";
    }
    // Parents before children, so every slot path exists when its part goes in.
    const parts = [...(input.parts ?? [])].sort((a, b) => a.slotPath.length - b.slotPath.length);
    for (const entry of parts) {
      const installed = installPart(root, source.lookup, entry.slotPath, entry.item);
      root = installed.root;
      if (installed.note) warnings.push(installed.note);
      if (installed.conflict) warnings.push(`${installed.part.name} in ${installed.label}: ${installed.conflict}.`);
    }
  } else {
    throw new InputError("Describe the build with shareLink or weapon.");
  }

  const weapon = source.lookup.get(root.itemId);
  if (!weapon?.isWeapon) throw new InputError("The build's root item is not a known weapon.");
  warnings.push(...treeProblems(root, source.lookup));
  if (input.ammo) {
    const { ammo, fits, note } = await resolveAmmo(source, root, input.ammo);
    ammoId = ammo.id;
    if (note) warnings.push(note);
    if (!fits) warnings.push(`${ammo.name} does not fit this build's magazine or chamber.`);
  }
  return { name: name || `${weapon.shortName} build`, weaponId: root.itemId, root, ammoId, warnings };
}

/** "/slot:item" paths for every installed part, for counting what changed. */
export function collectPaths(root: BuildNode) {
  const paths: string[] = [];
  const walk = (node: BuildNode, prefix: string) => {
    for (const [slotId, child] of Object.entries(node.slots)) {
      const path = `${prefix}/${slotId}:${child.itemId}`;
      paths.push(path);
      walk(child, path);
    }
  };
  walk(root, "");
  return paths;
}
