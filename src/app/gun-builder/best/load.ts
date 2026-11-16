import { cache } from "react";
import { getWeaponBestBuilds, listBestBuildWeapons } from "@/app/lib/builds/best-builds";
import { readForRender, requestGameMode } from "@/app/lib/api/server-render";

/** Every weapon with a best-build page. Weapon lists match across modes, so PVP's is used. */
export const loadBestBuildWeapons = cache(() => readForRender("Best builds list", () => listBestBuildWeapons("regular")));

/** undefined: couldn't be worked out in time. null: no such weapon. */
export const loadWeaponBestBuilds = cache(async (slug: string) => {
  const gameMode = await requestGameMode();
  return readForRender("Best builds page", () => getWeaponBestBuilds(gameMode, slug));
});
