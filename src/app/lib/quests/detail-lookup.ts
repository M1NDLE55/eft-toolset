import type { GameMode } from "@/components/game-mode/mode";

const OTHER_MODE: Record<GameMode, GameMode> = { regular: "pve", pve: "regular" };

// Zone quests have a copy in each mode, told apart only by this suffix.
const ZONE_SUFFIX = /-(pvp|pve)-zone$/;

/** The other mode's copy of a zone quest's slug ("…-pvp-zone" ↔ "…-pve-zone"); null for any other slug. */
export function zoneCounterpart(slug: string) {
  const match = ZONE_SUFFIX.exec(slug);
  return match ? slug.replace(ZONE_SUFFIX, match[1] === "pvp" ? "-pve-zone" : "-pvp-zone") : null;
}

/**
 * Finds a quest for a visitor in `gameMode`: this mode's quest with that slug, else this mode's
 * copy of a zone quest from the other mode, else the other mode's quest, for a quest only it has.
 */
export async function findQuestDetail<Detail>(
  gameMode: GameMode,
  slug: string,
  get: (gameMode: GameMode, slug: string) => Promise<Detail | null>
): Promise<Detail | null> {
  const counterpart = zoneCounterpart(slug);
  return (
    (await get(gameMode, slug)) ??
    (counterpart !== null ? await get(gameMode, counterpart) : null) ??
    (await get(OTHER_MODE[gameMode], slug))
  );
}
