import { cache } from "react";
import { getAllAmmo } from "@/app/lib/api/tarkov-server";
import { readForRender, requestGameMode } from "@/app/lib/api/server-render";
import { groupAmmo } from "@/app/lib/seo/ammo";

/** Rounds grouped by calibre for the visitor's game mode, or undefined when not loaded in time. */
export const loadCalibers = cache(async () => {
  const gameMode = await requestGameMode();
  const ammo = await readForRender("Ammo chart", () => getAllAmmo(gameMode));
  return ammo ? { gameMode, calibers: groupAmmo(ammo) } : undefined;
});
