import type { BuildNode, GunBuild } from "@/app/lib/types/gunBuilder";

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

const GZIP_PREFIX = "gz.";
const JSON_PREFIX = "j.";

export function slugifyBuildName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "shared-build";
}

export function createShareRecipe(build: GunBuild): SharedGunBuildRecipeV1 {
  return {
    v: 1,
    n: build.name,
    w: build.weaponId,
    r: encodeNode(build.root),
  };
}

export async function encodeBuildSharePayload(build: GunBuild) {
  const recipe = createShareRecipe(build);
  const bytes = new TextEncoder().encode(JSON.stringify(recipe));
  const compressed = await gzip(bytes);

  if (compressed && compressed.length < bytes.length) {
    return `${GZIP_PREFIX}${bytesToBase64Url(compressed)}`;
  }

  return `${JSON_PREFIX}${bytesToBase64Url(bytes)}`;
}

export async function decodeBuildSharePayload(
  payload: string
): Promise<DecodedSharedBuild> {
  const trimmed = payload.trim();
  const bytes = trimmed.startsWith(GZIP_PREFIX)
    ? await gunzip(base64UrlToBytes(trimmed.slice(GZIP_PREFIX.length)))
    : trimmed.startsWith(JSON_PREFIX)
      ? base64UrlToBytes(trimmed.slice(JSON_PREFIX.length))
      : base64UrlToBytes(trimmed);

  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
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

async function gzip(bytes: Uint8Array) {
  if (typeof CompressionStream === "undefined") return null;

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot read compressed shared builds.");
  }

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
