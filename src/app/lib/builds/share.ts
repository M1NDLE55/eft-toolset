import type { BuildNode, GunBuild } from "@/app/lib/types/gunBuilder";
import {
  decodeSharePayload,
  encodeSharePayload,
  slugifyName,
} from "@/app/lib/share-codec";
import {
  MAX_BUILD_NAME_LENGTH,
  MAX_BUILD_TREE_DEPTH,
  MAX_BUILD_TREE_NODES,
  MAX_SLOTS_PER_NODE,
} from "./limits";
import { isBuildTree, isValidBuildId } from "./tree";

type SharedBuildNodeV1 = [string] | [string, [string, SharedBuildNodeV1][]];

export interface SharedGunBuildRecipeV1 {
  v: 1;
  n?: string;
  w: string;
  r: SharedBuildNodeV1;
  a?: string;
}

export interface DecodedSharedBuild {
  name: string;
  weaponId: string;
  root: BuildNode;
  ammoId: string | null;
}

const RECIPE_KEYS = new Set(["v", "n", "w", "r", "a"]);

export function slugifyBuildName(name: string) {
  return slugifyName(name, "shared-build");
}

export function createShareRecipe(build: GunBuild): SharedGunBuildRecipeV1 {
  if (
    build.name.length > MAX_BUILD_NAME_LENGTH ||
    !isValidBuildId(build.weaponId) ||
    !isBuildTree(build.root) ||
    build.root.itemId !== build.weaponId ||
    (build.ammoId !== undefined && !isValidBuildId(build.ammoId))
  ) {
    throw new Error("This build exceeds the safe sharing limits.");
  }
  return {
    v: 1,
    n: build.name,
    w: build.weaponId,
    r: encodeNode(build.root),
    ...(build.ammoId ? { a: build.ammoId } : {}),
  };
}

export function encodeBuildSharePayload(build: GunBuild) {
  return encodeSharePayload(createShareRecipe(build));
}

export async function decodeBuildSharePayload(
  payload: string
): Promise<DecodedSharedBuild> {
  const parsed = await decodeSharePayload(payload);
  const recipe = parseRecipe(parsed);

  return {
    name: recipe.n?.trim() ?? "",
    weaponId: recipe.w,
    root: decodeNode(recipe.r),
    ammoId: recipe.a ?? null,
  };
}

function encodeNode(node: BuildNode): SharedBuildNodeV1 {
  const slots = Object.entries(node.slots)
    .sort(([a], [b]) => a.localeCompare(b))
    .map<[string, SharedBuildNodeV1]>(([slotId, child]) => [
      slotId,
      encodeNode(child),
    ]);

  return slots.length > 0 ? [node.itemId, slots] : [node.itemId];
}

function decodeNode(node: SharedBuildNodeV1): BuildNode {
  const [itemId, slots = []] = node;

  return {
    itemId,
    slots: Object.fromEntries(
      slots.map(([slotId, child]) => [slotId, decodeNode(child)])
    ),
  };
}

function parseRecipe(value: unknown): SharedGunBuildRecipeV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Shared build is not a valid recipe.");
  }
  if (Object.keys(value).some((key) => !RECIPE_KEYS.has(key))) {
    throw new Error("Shared build contains unsupported fields.");
  }

  const recipe = value as Partial<SharedGunBuildRecipeV1>;
  if (
    recipe.v !== 1 ||
    !isValidBuildId(recipe.w) ||
    (recipe.n !== undefined &&
      (typeof recipe.n !== "string" || recipe.n.length > MAX_BUILD_NAME_LENGTH)) ||
    (recipe.a !== undefined && !isValidBuildId(recipe.a))
  ) {
    throw new Error("Shared build uses an unsupported recipe version.");
  }

  if (!isSharedNode(recipe.r) || recipe.r[0] !== recipe.w) {
    throw new Error("Shared build tree is invalid.");
  }

  return recipe as SharedGunBuildRecipeV1;
}

function isSharedNode(value: unknown): value is SharedBuildNodeV1 {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  let count = 0;

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    count += 1;
    if (count > MAX_BUILD_TREE_NODES || depth > MAX_BUILD_TREE_DEPTH) return false;
    if (!Array.isArray(node) || !isValidBuildId(node[0])) {
      return false;
    }
    if (node.length === 1) continue;
    if (node.length !== 2 || !Array.isArray(node[1]) || node[1].length > MAX_SLOTS_PER_NODE) {
      return false;
    }

    const slotIds = new Set<string>();
    for (const slot of node[1]) {
      if (
        !Array.isArray(slot) ||
        slot.length !== 2 ||
        !isValidBuildId(slot[0]) ||
        slotIds.has(slot[0])
      ) {
        return false;
      }
      slotIds.add(slot[0]);
      stack.push({ node: slot[1], depth: depth + 1 });
    }
  }

  return true;
}
