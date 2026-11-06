import type { StoreDefinition } from "@/app/lib/storage/versioned-store";

export type GameMode = "regular" | "pve";

export const GAME_MODE_COOKIE = "eft-game-mode";

export function isGameMode(value: unknown): value is GameMode {
  return value === "regular" || value === "pve";
}

export const GAME_MODE_STORE: StoreDefinition<GameMode> = {
  key: "eft-toolset:settings:game-mode",
  legacyKeys: ["eft-toolset:game-mode"],
  version: 1,
  defaultValue: () => "regular",
  validate: isGameMode,
};
