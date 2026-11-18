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

/**
 * One quest in the visitor's game mode, or in the other one when only that mode has it
 * (`detail.gameMode` says which). undefined: couldn't be worked out in time. null: no such quest.
 */
export const loadQuestDetail = cache(async (slug: string) => {
  const gameMode = await requestGameMode();
  return readForRender("Quest page", async () => {
    const detail = (await getQuestDetail(gameMode, slug)) ?? (await getQuestDetail(OTHER_MODE[gameMode], slug));
    return detail && { gameMode, detail, renderedAt: Date.now() };
  });
});
