import type { GunBuild } from "@/app/lib/types/gunBuilder";
import { isSafeTimestamp } from "@/app/lib/text-safety";
import { MAX_BUILD_NAME_LENGTH, MAX_BUILDS } from "./limits";
import { isBuildTree, isValidBuildId } from "./tree";

export function isBuildList(value: unknown): value is GunBuild[] {
  return Array.isArray(value) && value.length <= MAX_BUILDS && value.every(isGunBuild);
}

export function isGunBuild(value: unknown): value is GunBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<GunBuild>;
  return (
    isValidBuildId(build.id) &&
    typeof build.name === "string" &&
    build.name.length <= MAX_BUILD_NAME_LENGTH &&
    isValidBuildId(build.weaponId) &&
    isSafeTimestamp(build.createdAt) &&
    isSafeTimestamp(build.updatedAt) &&
    isBuildTree(build.root) &&
    build.root.itemId === build.weaponId &&
    (build.ammoId === undefined || isValidBuildId(build.ammoId))
  );
}
