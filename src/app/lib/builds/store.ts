"use client";

import type { BuildNode, GunBuild } from "@/app/lib/types/gunBuilder";
import { readStore, subscribeStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";

const BUILD_STORE: StoreDefinition<GunBuild[]> = {
  key: "eft-toolset:gun-builds",
  legacyKeys: ["gun-builds"],
  version: 1,
  defaultValue: () => [],
  validate: isBuildList,
};

function now() {
  return Date.now();
}

function ensureBuilds(): GunBuild[] {
  return readStore(BUILD_STORE);
}

function writeBuilds(builds: GunBuild[]) {
  writeStore(BUILD_STORE, builds);
}

export function listBuilds(): GunBuild[] {
  return ensureBuilds().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function subscribeBuilds(listener: () => void) {
  return subscribeStore(BUILD_STORE.key, listener);
}

export function getBuild(id: string): GunBuild | undefined {
  return ensureBuilds().find((build) => build.id === id);
}

export function createBuild(name: string, weaponId: string): GunBuild {
  const timestamp = now();
  const build: GunBuild = {
    id: crypto.randomUUID(),
    name,
    weaponId,
    root: { itemId: weaponId, slots: {} },
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writeBuilds([...ensureBuilds(), build]);
  return build;
}

export function importBuild(
  name: string,
  weaponId: string,
  root: BuildNode
): GunBuild {
  const timestamp = now();
  const build: GunBuild = {
    id: crypto.randomUUID(),
    name,
    weaponId,
    root: cloneNode(root),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writeBuilds([...ensureBuilds(), build]);
  return build;
}

export function saveBuild(build: GunBuild): GunBuild {
  const updated: GunBuild = { ...build, updatedAt: now() };
  const builds = ensureBuilds().map((candidate) =>
    candidate.id === build.id ? updated : candidate
  );
  writeBuilds(builds);
  return updated;
}

export function renameBuild(id: string, name: string): GunBuild | undefined {
  const build = getBuild(id);
  if (!build) return undefined;
  return saveBuild({ ...build, name });
}

export function duplicateBuild(id: string): GunBuild | undefined {
  const build = getBuild(id);
  if (!build) return undefined;

  const timestamp = now();
  const duplicate: GunBuild = {
    ...build,
    id: crypto.randomUUID(),
    name: `${build.name} copy`,
    root: cloneNode(build.root),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writeBuilds([...ensureBuilds(), duplicate]);
  return duplicate;
}

export function deleteBuild(id: string) {
  writeBuilds(ensureBuilds().filter((build) => build.id !== id));
}

function cloneNode(node: BuildNode): BuildNode {
  return {
    itemId: node.itemId,
    slots: Object.fromEntries(
      Object.entries(node.slots).map(([slotId, child]) => [
        slotId,
        cloneNode(child),
      ])
    ),
  };
}

function updateAtPath(
  node: BuildNode,
  path: string[],
  updater: (node: BuildNode) => BuildNode
): BuildNode {
  if (path.length === 0) return updater(node);
  const [slotId, ...rest] = path;
  const child = node.slots[slotId];
  if (!child) return node;

  return {
    ...node,
    slots: {
      ...node.slots,
      [slotId]: updateAtPath(child, rest, updater),
    },
  };
}

export function attachMod(
  root: BuildNode,
  path: string[],
  slotId: string,
  itemId: string
): BuildNode {
  return updateAtPath(root, path, (node) => ({
    ...node,
    slots: {
      ...node.slots,
      [slotId]: { itemId, slots: {} },
    },
  }));
}

export function removeMod(root: BuildNode, path: string[]): BuildNode {
  if (path.length === 0) return root;

  const parentPath = path.slice(0, -1);
  const slotToRemove = path[path.length - 1];

  return updateAtPath(root, parentPath, (node) => {
    const nextSlots = { ...node.slots };
    delete nextSlots[slotToRemove];
    return { ...node, slots: nextSlots };
  });
}

function isBuildList(value: unknown): value is GunBuild[] {
  return Array.isArray(value) && value.length <= 500 && value.every(isGunBuild);
}

function isGunBuild(value: unknown): value is GunBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<GunBuild>;
  return (
    typeof build.id === "string" &&
    typeof build.name === "string" &&
    build.name.length <= 120 &&
    typeof build.weaponId === "string" &&
    typeof build.createdAt === "number" &&
    Number.isFinite(build.createdAt) &&
    typeof build.updatedAt === "number" &&
    Number.isFinite(build.updatedAt) &&
    isBuildNode(build.root)
  );
}

function isBuildNode(value: unknown): value is BuildNode {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  let count = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    count += 1;
    if (count > 1_000 || depth > 64 || !node || typeof node !== "object") return false;
    const candidate = node as Partial<BuildNode>;
    if (typeof candidate.itemId !== "string" || !candidate.slots || typeof candidate.slots !== "object") {
      return false;
    }
    const children = Object.values(candidate.slots);
    if (children.length > 64) return false;
    for (const child of children) stack.push({ node: child, depth: depth + 1 });
  }
  return true;
}
