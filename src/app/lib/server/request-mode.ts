import { getCookie } from "@tanstack/react-start/server";
import { GAME_MODE_COOKIE, type GameMode } from "@/components/game-mode/mode";

/**
 * The game mode a server render or server-function read is for: the visitor's `eft-game-mode`
 * cookie, which the client keeps in step with its saved setting (PVP without one). The edge page
 * cache keys on the same cookie (src/app/lib/server/page-cache.ts), so each mode is cached apart.
 */
export function requestGameMode(): GameMode {
  return getCookie(GAME_MODE_COOKIE) === "pve" ? "pve" : "regular";
}
