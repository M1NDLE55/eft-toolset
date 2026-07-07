import type { BuildNode, GunBuild } from "@/app/lib/types/gunBuilder";
import {
  decodeSharePayload,
  encodeSharePayload,
  slugifyName,
} from "@/app/lib/share-codec";

type SharedBuildNodeV1 = [string] | [string, [string, SharedBuildNodeV1][]];

export interface SharedGunBuildRecipeV1 {
  v: 1;
  n?: string;
  w: string;
  r: SharedBuildNodeV1;
}

export interface DecodedSharedBuild {
  name: string;
  weaponId: string;
  root: BuildNode;
}

export function slugifyBuildName(name: string) {
  return slugifyName(name, "shared-build");
}

export function createShareRecipe(build: GunBuild): SharedGunBuildRecipeV1 {
  return {
    v: 1,
    n: build.name,
    w: build.weaponId,
    r: encodeNode(build.root),
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
    name: recipe.n?.trim() || "Shared build",
    weaponId: recipe.w,
    root: decodeNode(recipe.r),
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
  if (!value || typeof value !== "object") {
    throw new Error("Shared build is not a valid recipe.");
  }

  const recipe = value as Partial<SharedGunBuildRecipeV1>;
  if (recipe.v !== 1 || typeof recipe.w !== "string" || !recipe.w) {
    throw new Error("Shared build uses an unsupported recipe version.");
  }

  if (!isSharedNode(recipe.r)) {
    throw new Error("Shared build tree is invalid.");
  }

  return recipe as SharedGunBuildRecipeV1;
}

function isSharedNode(value: unknown): value is SharedBuildNodeV1 {
  if (!Array.isArray(value) || typeof value[0] !== "string") return false;
  if (value.length === 1) return true;
  if (value.length !== 2 || !Array.isArray(value[1])) return false;

  return value[1].every(
    (slot) =>
      Array.isArray(slot) &&
      slot.length === 2 &&
      typeof slot[0] === "string" &&
      isSharedNode(slot[1])
  );
}
