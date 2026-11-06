"use client";

import type { BuildNode, GunBuild, PriceSources } from "@/app/lib/types/gunBuilder";
import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";
import { createId } from "@/app/lib/id";
import { MAX_BUILD_NAME_LENGTH, MAX_BUILDS } from "./limits";
import { cloneTree, isBuildTree, isValidBuildId } from "./tree";

export const BUILD_STORE: StoreDefinition<GunBuild[]> = {
  key: "eft-toolset:gun-builds",
  legacyKeys: ["gun-builds"],
  version: 1,
  defaultValue: () => [],
  validate: isBuildList,
  recover: (value) =>
    Array.isArray(value) ? value.filter(isGunBuild).slice(0, MAX_BUILDS) : undefined,
};

export const PRICE_SOURCE_STORE: StoreDefinition<PriceSources> = {
  key: "eft-toolset:gun-builder:price-sources",
  version: 1,
  defaultValue: () => ({ traders: true, flea: true }),
  validate: (value): value is PriceSources =>
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as PriceSources).traders === "boolean" &&
    typeof (value as PriceSources).flea === "boolean",
};

export const VIEW_STORE: StoreDefinition<{ hideEmpty: boolean }> = {
  key: "eft-toolset:gun-builder:view",
  version: 1,
  defaultValue: () => ({ hideEmpty: false }),
  validate: (value): value is { hideEmpty: boolean } =>
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { hideEmpty: unknown }).hideEmpty === "boolean",
};

export function useBuilderView() {
  return useStore(VIEW_STORE);
}

export function setHideEmptySlots(hideEmpty: boolean) {
  writeStore(VIEW_STORE, { hideEmpty });
}

export function useBuilds() {
  return useStore(BUILD_STORE);
}

export function usePriceSources() {
  return useStore(PRICE_SOURCE_STORE);
}

export function setPriceSources(sources: PriceSources) {
  writeStore(PRICE_SOURCE_STORE, sources);
}

export function findBuild(builds: GunBuild[], id: string) {
  return builds.find((build) => build.id === id);
}

export function sortBuilds(builds: GunBuild[]) {
  return builds.toSorted((a, b) => b.updatedAt - a.updatedAt);
}

export function validBuildName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a build name.");
  if (trimmed.length > MAX_BUILD_NAME_LENGTH) {
    throw new Error(`Build names can be at most ${MAX_BUILD_NAME_LENGTH} characters.`);
  }
  return trimmed;
}

function insert(build: GunBuild) {
  const builds = readStore(BUILD_STORE);
  if (builds.length >= MAX_BUILDS) {
    throw new Error(`You can save at most ${MAX_BUILDS} builds. Delete one to make room.`);
  }
  writeStore(BUILD_STORE, [...builds, build]);
  return build;
}

export function createBuild(name: string, weaponId: string, root?: BuildNode): GunBuild {
  const timestamp = Date.now();
  return insert({
    id: createId(),
    name: validBuildName(name),
    weaponId,
    root: root && root.itemId === weaponId ? cloneTree(root) : { itemId: weaponId, slots: {} },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function updateBuild(id: string, update: (build: GunBuild) => GunBuild): GunBuild {
  const builds = readStore(BUILD_STORE);
  const current = findBuild(builds, id);
  if (!current) throw new Error("This build no longer exists in browser storage.");
  const next: GunBuild = { ...update(current), id, updatedAt: Date.now() };
  writeStore(
    BUILD_STORE,
    builds.map((build) => (build.id === id ? next : build))
  );
  return next;
}

export function updateBuildTree(id: string, update: (root: BuildNode) => BuildNode) {
  return updateBuild(id, (build) => ({ ...build, root: update(build.root) }));
}

export function renameBuild(id: string, name: string) {
  const trimmed = validBuildName(name);
  return updateBuild(id, (build) => ({ ...build, name: trimmed }));
}

export function duplicateBuild(id: string): GunBuild {
  const build = findBuild(readStore(BUILD_STORE), id);
  if (!build) throw new Error("This build no longer exists in browser storage.");
  const timestamp = Date.now();
  return insert({
    ...build,
    id: createId(),
    name: `${build.name.slice(0, MAX_BUILD_NAME_LENGTH - 5)} copy`,
    root: cloneTree(build.root),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function deleteBuild(id: string) {
  writeStore(
    BUILD_STORE,
    readStore(BUILD_STORE).filter((build) => build.id !== id)
  );
}

function isBuildList(value: unknown): value is GunBuild[] {
  return Array.isArray(value) && value.length <= MAX_BUILDS && value.every(isGunBuild);
}

function isGunBuild(value: unknown): value is GunBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<GunBuild>;
  return (
    isValidBuildId(build.id) &&
    typeof build.name === "string" &&
    build.name.length <= MAX_BUILD_NAME_LENGTH &&
    isValidBuildId(build.weaponId) &&
    typeof build.createdAt === "number" &&
    Number.isFinite(build.createdAt) &&
    typeof build.updatedAt === "number" &&
    Number.isFinite(build.updatedAt) &&
    isBuildTree(build.root) &&
    build.root.itemId === build.weaponId
  );
}
