import { cache } from "react";
import { getAllAmmo } from "@/app/lib/api/tarkov-server";
import { readForRender } from "@/app/lib/api/server-render";
import { groupAmmo } from "@/app/lib/seo/ammo";
import type { GameMode } from "@/components/game-mode/mode";

/** Rounds grouped by calibre for the game mode, or undefined when not loaded in time. */
export const loadCalibers = cache(async (gameMode: GameMode) => {
  const ammo = await readForRender("Ammo chart", () => getAllAmmo(gameMode));
  return ammo ? { gameMode, calibers: groupAmmo(ammo) } : undefined;
});
