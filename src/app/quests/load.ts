import { cache } from "react";
import { getQuestDetail, getQuestList } from "@/app/lib/api/tarkov-server";
import { readForRender, requestGameMode } from "@/app/lib/api/server-render";
import type { GameMode } from "@/components/game-mode/mode";

/** The visitor's game mode's quest list, to render and to seed the client cache; undefined when it couldn't be read in time. */
export const loadQuestList = cache(async () => {
  const gameMode = await requestGameMode();
  const list = await readForRender("Quest list", () => getQuestList(gameMode));
  return list && { gameMode, list, renderedAt: Date.now() };
});

const OTHER_MODE: Record<GameMode, GameMode> = { regular: "pve", pve: "regular" };

// Zone quests have a copy in each mode, told apart only by this suffix.
const ZONE_SUFFIX = /-(pvp|pve)-zone$/;

function zoneCounterpart(slug: string) {
  const match = ZONE_SUFFIX.exec(slug);
  return match ? slug.replace(ZONE_SUFFIX, match[1] === "pvp" ? "-pve-zone" : "-pvp-zone") : null;
}

/**
 * One quest in the visitor's game mode. A zone quest from the other mode gives this mode's copy,
 * and a quest only the other mode has comes from that mode (`detail.gameMode` says which), so
 * `detail.quest.slug` can differ from the slug asked for. undefined: couldn't be worked out in
 * time. null: no such quest.
 */
export const loadQuestDetail = cache(async (slug: string) => {
  const gameMode = await requestGameMode();
  return readForRender("Quest page", async () => {
    const counterpart = zoneCounterpart(slug);
    const detail =
      (await getQuestDetail(gameMode, slug)) ??
      (counterpart && (await getQuestDetail(gameMode, counterpart))) ??
      (await getQuestDetail(OTHER_MODE[gameMode], slug));
    return detail ? { gameMode, detail, renderedAt: Date.now() } : null;
  });
});
