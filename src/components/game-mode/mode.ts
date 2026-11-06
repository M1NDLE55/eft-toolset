export type GameMode = "regular" | "pve";

export const GAME_MODE_COOKIE = "eft-game-mode";

export function isGameMode(value: unknown): value is GameMode {
  return value === "regular" || value === "pve";
}
