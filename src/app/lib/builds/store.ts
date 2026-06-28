"use client";

import type { BuildNode, GunBuild } from "@/app/lib/types/gunBuilder";

const STORAGE_KEY = "gun-builds";

function now() {
  return Date.now();
}

function ensureBuilds(): GunBuild[] {
  if (typeof window === "undefined") return [];
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    window.localStorage.setItem(STORAGE_KEY, "[]");
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as GunBuild[]) : [];
  } catch {
    return [];
  }
}

function writeBuilds(builds: GunBuild[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(builds));
}

export function listBuilds(): GunBuild[] {
  return ensureBuilds().sort((a, b) => b.updatedAt - a.updatedAt);
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
