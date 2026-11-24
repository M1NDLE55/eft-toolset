import type { BuildNode, GunBuild, PriceSources } from "@/app/lib/types/gunBuilder";
import { readStore, writeStore, type StoreDefinition } from "@/app/lib/storage/versioned-store";
import { useStore } from "@/app/lib/storage/use-store";
import { createId } from "@/app/lib/id";
import { MAX_BUILD_NAME_LENGTH, MAX_BUILDS } from "./limits";
import { cloneTree, isValidBuildId } from "./tree";
import { isBuildList, isGunBuild } from "./validation";
import { STORE_KEYS } from "@/app/lib/storage/store-keys";
import { activeLibrary, useAccountView } from "@/app/lib/account-sync/account-session";
import type { LibraryView } from "@/app/lib/account-sync/account-library";
import type { BuildRecord } from "@/app/lib/sharing/types";
import { USER_LIMITS } from "@/app/lib/durable/limits";

export const BUILD_STORE: StoreDefinition<GunBuild[]> = {
  key: STORE_KEYS.gunBuilds,
  legacyKeys: ["gun-builds"],
  version: 2,
  defaultValue: () => [],
  validate: isBuildList,
  migrate: (value, version) => (version === 1 && isBuildList(value) ? value : undefined),
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

/*
 * Signed in, builds come from the account library (src/app/lib/account-sync): reads are its
 * optimistic local copy, and every change below becomes a mutation that syncs. Signed out, they stay
 * in this browser's localStorage as before.
 */
export function toGunBuild(record: BuildRecord): GunBuild {
  return {
    id: record.id,
    name: record.name,
    weaponId: record.weaponId,
    root: record.root,
    ...(record.ammoId ? { ammoId: record.ammoId } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const accountBuildLists = new WeakMap<LibraryView["builds"], GunBuild[]>();

function accountBuilds(view: LibraryView): GunBuild[] {
  let list = accountBuildLists.get(view.builds);
  if (!list) {
    list = view.builds.map(toGunBuild);
    accountBuildLists.set(view.builds, list);
  }
  return list;
}

function readBuilds(): GunBuild[] {
  const library = activeLibrary();
  return library ? accountBuilds(library.view()) : readStore(BUILD_STORE);
}

export function useBuilds() {
  const local = useStore(BUILD_STORE);
  const account = useAccountView();
  return account ? accountBuilds(account) : local;
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
  const builds = readBuilds();
  const library = activeLibrary();
  const limit = library ? USER_LIMITS.builds : MAX_BUILDS;
  if (builds.length >= limit) {
    throw new Error(`You can save at most ${limit} builds. Delete one to make room.`);
  }
  if (library) {
    const id = library.createBuild({ name: build.name, weaponId: build.weaponId, root: build.root, ...(build.ammoId ? { ammoId: build.ammoId } : {}) });
    return { ...build, id };
  }
  writeStore(BUILD_STORE, [...builds, build]);
  return build;
}

export function createBuild(
  name: string,
  weaponId: string,
  root?: BuildNode,
  ammoId?: string | null
): GunBuild {
  const timestamp = Date.now();
  return insert({
    id: createId(),
    name: validBuildName(name),
    weaponId,
    root: root && root.itemId === weaponId ? cloneTree(root) : { itemId: weaponId, slots: {} },
    ...(ammoId && isValidBuildId(ammoId) ? { ammoId } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function setBuildAmmo(id: string, ammoId: string | null) {
  if (ammoId !== null && !isValidBuildId(ammoId)) throw new Error("That ammo type is not valid.");
  return updateBuild(id, (build) => {
    const next = { ...build };
    if (ammoId) next.ammoId = ammoId;
    else delete next.ammoId;
    return next;
  });
}

export function updateBuild(id: string, update: (build: GunBuild) => GunBuild): GunBuild {
  const library = activeLibrary();
  const builds = readBuilds();
  const current = findBuild(builds, id);
  if (!current) throw new Error(library ? "This build no longer exists in your library." : "This build no longer exists in browser storage.");
  const next: GunBuild = { ...update(current), id, updatedAt: Date.now() };
  if (library) {
    const record = library.get("build", id) as BuildRecord;
    const { ammoId: _ammo, ...rest } = record;
    void _ammo;
    library.update("build", id, { ...rest, name: next.name, root: next.root, ...(next.ammoId ? { ammoId: next.ammoId } : {}) });
    return next;
  }
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
  const build = findBuild(readBuilds(), id);
  if (!build) throw new Error("This build no longer exists.");
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
  const library = activeLibrary();
  if (library) {
    library.remove("build", id);
    return;
  }
  writeStore(
    BUILD_STORE,
    readStore(BUILD_STORE).filter((build) => build.id !== id)
  );
}
